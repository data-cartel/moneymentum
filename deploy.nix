{ deploy-rs, self }:

let
  system = "x86_64-linux";
  inherit (deploy-rs.lib.${system}) activate;
  profileBase = "/nix/var/nix/profiles/per-service";

  moneymentumPackage = self.packages.${system}.moneymentum;

  services = import ./services.nix;
  enabledServices = builtins.filter (name: services.${name}.enabled) (builtins.attrNames services);

  mkServiceProfile =
    name:
    let
      markerFile = "/run/moneymentum/${name}.ready";
    in
    activate.custom moneymentumPackage (
      builtins.concatStringsSep " && " [
        "systemctl stop ${name} || true"
        "rm -f ${markerFile}"
        "mkdir -p /run/moneymentum"
        "touch ${markerFile}"
        "systemctl restart ${name}"
      ]
    );

  mkProfile = name: {
    path = mkServiceProfile name;
    profilePath = "${profileBase}/${name}";
  };

in
{
  config = {
    nodes.moneymentum = {
      hostname = "MUST_OVERRIDE_HOSTNAME";
      sshUser = "root";
      user = "root";

      # Failed activations already roll back the profile copy; re-running
      # switch-to-configuration on the previous generation often hangs while
      # stopping dbus-broker (nixpkgs#527469) and blocks deploy for the full
      # activation timeout.
      autoRollback = false;
      activationTimeout = 600;

      profilesOrder = [ "system" ] ++ enabledServices;

      profiles = {
        system.path = activate.nixos self.nixosConfigurations.moneymentum;
      }
      // builtins.listToAttrs (
        map (name: {
          inherit name;
          value = mkProfile name;
        }) enabledServices
      );
    };
  };

  wrappers =
    {
      pkgs,
      infraPkgs,
      localSystem,
    }:
    let
      # Only rage (decrypt state) + jq (parse IP) + deploy-rs are needed.
      # infraPkgs.buildInputs also includes terraform and ragenix which
      # deploy scripts never use.
      deployInputs = [
        pkgs.rage
        pkgs.jq
        deploy-rs.packages.${localSystem}.deploy-rs
      ];

      resolvePreamble = ''
        ${infraPkgs.resolveIp}

        if [ -z "$host_ip" ]; then
          echo "ERROR: host_ip not resolved -- check resolveIp or --hostname flag" >&2
          exit 1
        fi
      '';

      deployPreamble = ''
        ${resolvePreamble}

        ssh_flag=""
        if [ "$identity" != "$HOME/.ssh/id_ed25519" ]; then
          export NIX_SSHOPTS="-i $identity"
          ssh_flag="--ssh-opts=-i $identity"
        fi
      '';

      deployFlags =
        if localSystem == "x86_64-linux" then "--skip-checks" else "--remote-build --skip-checks";

      serviceResetLines = builtins.concatStringsSep "\n" (
        map (name: "systemctl reset-failed ${name} || true") enabledServices
      );

      # Remote preflight plus the local logind poll, shared by deployServer and
      # deployStaged. Runs on the remote host via heredoc so nested quotes do
      # not break shellcheck or the generated scripts (SC2026).
      preflightScript = ''
        ssh -i "$identity" "root@$host_ip" bash -s <<'REMOTE_PREFLIGHT'
        set -eu
        systemctl stop 'nixos-rebuild-switch-to-configuration*' 2>/dev/null || true
        pkill -9 -f '[s]witch-to-configuration' || true
        rm -f /run/nixos/switch-to-configuration.lock
        systemctl stop moneymentum-markets-refresh.timer staging-markets-refresh.timer 2>/dev/null || true
        systemctl disable moneymentum-markets-refresh.timer staging-markets-refresh.timer 2>/dev/null || true
        ${serviceResetLines}
        systemd-run --on-active=3s --collect --unit=moneymentum-deploy-dbus-heal \
          /bin/sh -c 'systemctl reset-failed dbus-broker systemd-logind || true; systemctl restart dbus-broker; systemctl restart systemd-logind' \
          || true
        REMOTE_PREFLIGHT

        # dbus heal is scheduled for +3s after preflight SSH closes; poll logind
        # before deploy-rs activation so wedged logind fails fast instead of timing
        # out for the full activation window (nixpkgs#527469).
        for ((attempt = 1; attempt <= 15; attempt++)); do
          if ssh -i "$identity" "root@$host_ip" loginctl list-users >/dev/null 2>&1; then
            break
          fi
          if [ "$attempt" -eq 15 ]; then
            echo "ERROR: logind still unhealthy after deploy preflight" >&2
            exit 1
          fi
          sleep 2
        done
      '';

      # Health-and-markets verification against the freshly deployed staging
      # instance: migrations applied to a real database, the binary serving, and
      # the live Hyperliquid fetch working from the host's IP.
      stagingGateScript = ''
        echo "==> Verifying staging"
        staging_ok=""
        for delay in 2 4 8 16 32 32; do
          if curl -sSf --max-time 20 "http://$host_ip:8080/api/health" >/dev/null &&
            curl -sSf --max-time 30 "http://$host_ip:8080/api/hyperliquid/markets?network=mainnet" >/dev/null; then
            staging_ok=1
            break
          fi
          echo "staging not healthy yet; retrying in ''${delay}s"
          sleep "$delay"
        done
        if [ -z "$staging_ok" ]; then
          echo "ERROR: staging failed verification" >&2
          exit 1
        fi
      '';

    in
    {
      deployNixos = pkgs.writeShellApplication {
        name = "deploy-nixos";
        runtimeInputs = deployInputs;
        text = ''
          ${deployPreamble}
          deploy ${deployFlags} --hostname "$host_ip" ''${ssh_flag:+"$ssh_flag"} "$@" .#moneymentum.system
        '';
      };

      deployService = pkgs.writeShellApplication {
        name = "deploy-service";
        runtimeInputs = deployInputs;
        text = ''
          ${deployPreamble}
          profile="''${1:?usage: deploy-service <profile>}"
          shift
          deploy ${deployFlags} --hostname "$host_ip" ''${ssh_flag:+"$ssh_flag"} "$@" ".#moneymentum.$profile"
        '';
      };

      deployServer = pkgs.writeShellApplication {
        name = "deploy-server";
        runtimeInputs = deployInputs ++ [ pkgs.openssh ];
        text = ''
          ${deployPreamble}
          ${preflightScript}
          deploy ${deployFlags} --hostname "$host_ip" ''${ssh_flag:+"$ssh_flag"} "$@" .#moneymentum
        '';
      };

      # Staged rollout: the new binary must prove itself on staging before
      # production is touched. System profile first (shared host config), then
      # staging, then a health-and-markets gate against staging, and only then
      # the production service. A staging failure aborts with production still
      # on its previous generation.
      #
      # Residual risk: the system profile is shared, so unit or host config
      # changes still reach production units before the gate (#422).
      deployStaged = pkgs.writeShellApplication {
        name = "deploy-staged";
        runtimeInputs = deployInputs ++ [
          pkgs.openssh
          pkgs.curl
        ];
        text = ''
          ${deployPreamble}
          ${preflightScript}

          echo "==> Deploying the system profile"
          deploy ${deployFlags} --hostname "$host_ip" ''${ssh_flag:+"$ssh_flag"} .#moneymentum.system

          echo "==> Deploying staging"
          deploy ${deployFlags} --hostname "$host_ip" ''${ssh_flag:+"$ssh_flag"} .#moneymentum.staging

          ${stagingGateScript}

          echo "==> Staging verified; deploying production"
          deploy ${deployFlags} --hostname "$host_ip" ''${ssh_flag:+"$ssh_flag"} .#moneymentum.moneymentum
        '';
      };

      # Pull-request gate: deploy the PR's binary to staging and verify it, so
      # a reviewer knows the change survives a real deploy BEFORE merging. Only
      # the staging service profile is deployed -- an unmerged PR must not
      # reshape shared host config, so the system profile stays whatever master
      # last activated and system-level changes are verified by deployStaged at
      # merge time.
      deployStagingVerify = pkgs.writeShellApplication {
        name = "deploy-staging-verify";
        runtimeInputs = deployInputs ++ [
          pkgs.openssh
          pkgs.curl
        ];
        text = ''
          ${deployPreamble}
          ${preflightScript}

          echo "==> Deploying this revision to staging"
          deploy ${deployFlags} --hostname "$host_ip" ''${ssh_flag:+"$ssh_flag"} .#moneymentum.staging

          ${stagingGateScript}

          echo "==> Staging verified"
        '';
      };

      deployFrontend = pkgs.writeShellApplication {
        name = "deploy-frontend";
        runtimeInputs = deployInputs ++ [
          pkgs.openssh
          pkgs.rsync
        ];
        text = ''
          if [ "$#" -ne 0 ] && [ "''${1:-}" != "-i" ]; then
            echo "usage: deploy-frontend [-i identity]" >&2
            exit 1
          fi

          if [ "''${1:-}" = "-i" ] && [ "$#" -ne 2 ]; then
            echo "usage: deploy-frontend [-i identity]" >&2
            exit 1
          fi

          if [ ! -f frontend/dist/index.html ]; then
            echo "ERROR: frontend/dist/index.html missing -- run 'cd frontend && bun run build' first" >&2
            exit 1
          fi

          ${resolvePreamble}

          if [ "$#" -ne 0 ]; then
            echo "usage: deploy-frontend [-i identity]" >&2
            exit 1
          fi

          ssh -i "$identity" "root@$host_ip" 'mkdir -p /var/lib/moneymentum/frontend'
          rsync -az --delete -e "ssh -i $identity" frontend/dist/ "root@$host_ip:/var/lib/moneymentum/frontend/"
          ssh -i "$identity" "root@$host_ip" 'nginx -s reload || true'
        '';
      };
    };
}
