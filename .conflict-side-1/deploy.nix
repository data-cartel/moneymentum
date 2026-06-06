{ deploy-rs, self }:

let
  system = "x86_64-linux";
  inherit (deploy-rs.lib.${system}) activate;
  profileBase = "/nix/var/nix/profiles/per-service";

  moneymentumPackage = self.packages.${system}.moneymentum;

  services = import ./services.nix;
  enabledServices = builtins.filter (name: services.${name}.enabled)
    (builtins.attrNames services);

  mkServiceProfile = name:
    let markerFile = "/run/moneymentum/${name}.ready";
    in activate.custom moneymentumPackage (builtins.concatStringsSep " && " [
      "systemctl stop ${name} || true"
      "rm -f ${markerFile}"
      "mkdir -p /run/moneymentum"
      "touch ${markerFile}"
      "systemctl restart ${name}"
    ]);

  mkProfile = name: {
    path = mkServiceProfile name;
    profilePath = "${profileBase}/${name}";
  };

in {
  config = {
    nodes.moneymentum = {
      hostname = "MUST_OVERRIDE_HOSTNAME";
      sshUser = "root";
      user = "root";

      profilesOrder = [ "system" ] ++ enabledServices;

      profiles = {
        system.path = activate.nixos self.nixosConfigurations.moneymentum;
      } // builtins.listToAttrs (map (name: {
        inherit name;
        value = mkProfile name;
      }) enabledServices);
    };
  };

  wrappers = { pkgs, infraPkgs, localSystem }:
    let
      # Only rage (decrypt state) + jq (parse IP) + deploy-rs are needed.
      # infraPkgs.buildInputs also includes terraform and ragenix which
      # deploy scripts never use.
      deployInputs =
        [ pkgs.rage pkgs.jq deploy-rs.packages.${localSystem}.deploy-rs ];

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

      deployFlags = if localSystem == "x86_64-linux" then
        "--skip-checks"
      else
        "--remote-build --skip-checks";

      serviceCleanup = builtins.concatStringsSep "; "
        (map (name: "systemctl reset-failed ${name} || true") enabledServices);

    in {
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

          ssh -i "$identity" "root@$host_ip" '${serviceCleanup}'

          deploy ${deployFlags} --hostname "$host_ip" ''${ssh_flag:+"$ssh_flag"} "$@" .#moneymentum
        '';
      };

      deployFrontend = pkgs.writeShellApplication {
        name = "deploy-frontend";
        runtimeInputs = deployInputs ++ [ pkgs.openssh pkgs.rsync ];
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
