{
  pkgs,
  ragenix,
  nixos-anywhere,
  system,
}:

let
  buildInputs = [
    pkgs.terraform
    pkgs.rage
    pkgs.jq
    ragenix.packages.${system}.default
  ];

  tfState = "infra/terraform.tfstate";
  tfVars = "infra/terraform.tfvars";

  parseIdentity = ''
    set -eo pipefail

    identity=~/.ssh/id_ed25519
    if [ "''${1:-}" = "-i" ]; then
      identity="$2"
      shift 2
    fi
  '';

  decryptState = ''
    if [ -f ${tfState}.age ]; then
      rage -d -i "$identity" ${tfState}.age > ${tfState}
    fi
  '';

  encryptState = ''
    if [ -f ${tfState} ]; then
      nix eval --raw --file ${../keys.nix} roles.infra --apply 'builtins.concatStringsSep "\n"' \
        | rage -e -R /dev/stdin -o ${tfState}.age ${tfState}
    fi
  '';

  cleanup = "rm -f ${tfState} ${tfState}.backup ${tfVars}";

  preamble = ''
    ${parseIdentity}
    on_exit() { ${cleanup}; }
    trap on_exit EXIT
    ${decryptVars}
  '';

  preambleWithEncrypt = ''
    ${parseIdentity}
    on_exit() {
      ${encryptState}
      ${cleanup}
    }
    trap on_exit EXIT
    ${decryptVars}
  '';

  rekeyPreamble = ''
    ${parseIdentity}
    on_exit() {
      ${encryptState}
      ${cleanup}
    }
    trap on_exit EXIT
    ${decryptState}
    ${encryptState}
    ${decryptVars}
    ${encryptVars}
  '';

  resolveIp = ''
    ${parseIdentity}
    ${decryptState}
    host_ip=$(jq -r '.outputs.droplet_ipv4.value' ${tfState})
    rm -f ${tfState}
  '';

  decryptVars = ''
    rage -d -i "$identity" ${tfVars}.age > ${tfVars}
  '';

  encryptVars = ''
    nix eval --raw --file ${../keys.nix} roles.infra --apply 'builtins.concatStringsSep "\n"' \
      | rage -e -R /dev/stdin -o ${tfVars}.age ${tfVars}
  '';

  mkTask =
    name: body:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = buildInputs;
      text = body;
    };

in
{
  inherit buildInputs parseIdentity resolveIp;

  rekey = mkTask "rekey" ''
    ${rekeyPreamble}
    ragenix --rules ./config/secrets.nix -i "$identity" -r
  '';

  tfRekey = mkTask "tf-rekey" ''
    ${rekeyPreamble}
  '';

  tfInit = mkTask "tf-init" ''
    ${preamble}
    terraform -chdir=infra init "$@"
  '';

  tfPlan = mkTask "tf-plan" ''
    ${preamble}
    ${decryptState}
    terraform -chdir=infra plan -out=tfplan "$@"
  '';

  tfApply = mkTask "tf-apply" ''
    ${preambleWithEncrypt}
    ${decryptState}
    terraform -chdir=infra apply "$@" tfplan
  '';

  tfImport = mkTask "tf-import" ''
    ${preambleWithEncrypt}
    ${decryptState}
    terraform -chdir=infra import "$@"
  '';

  tfEditVars = mkTask "tf-edit-vars" ''
    ${parseIdentity}
    on_exit() { rm -f ${tfVars}; }
    trap on_exit EXIT

    ${decryptVars}
    ''${EDITOR:-vi} ${tfVars}
    ${encryptVars}
  '';

  tfCreateVars = mkTask "tf-create-vars" ''
    if [ -f ${tfVars}.age ]; then
      echo "Error: ${tfVars}.age already exists. Use tf-edit-vars to modify it."
      exit 1
    fi

    on_exit() { rm -f ${tfVars}; }
    trap on_exit EXIT

    cp ${tfVars}.example ${tfVars}
    ''${EDITOR:-vi} ${tfVars}
    ${encryptVars}
    echo "Created ${tfVars}.age"
  '';

  bootstrap = pkgs.writeShellApplication {
    name = "bootstrap-nixos";
    runtimeInputs = [
      pkgs.rage
      pkgs.jq
      ragenix.packages.${system}.default
      nixos-anywhere.packages.${system}.default
    ];
    text = ''
      ${resolveIp}
      ssh_opts=(-o StrictHostKeyChecking=no -o ConnectTimeout=5 -i "$identity")

      nixos-anywhere --flake ".#moneymentum" \
        --option pure-eval false \
        --ssh-option "IdentityFile=$identity" \
        --target-host "root@$host_ip" "$@"

      echo "Waiting for host to come back up..."
      retries=0
      until ssh "''${ssh_opts[@]}" "root@$host_ip" true 2>/dev/null; do
        retries=$((retries + 1))
        if [ "$retries" -ge 60 ]; then
          echo "Host did not come back up after 5 minutes" >&2
          exit 1
        fi
        sleep 5
      done

      new_key=$(
        ssh "''${ssh_opts[@]}" "root@$host_ip" \
          cat /etc/ssh/ssh_host_ed25519_key.pub \
          | awk '{print $1 " " $2}'
      )

      ${pkgs.gnused}/bin/sed -i -z \
        's|host =\n      "ssh-ed25519 [^"]*";|host =\n      "'"$new_key"'";|' \
        keys.nix

      if ! grep -q "$new_key" keys.nix; then
        echo "ERROR: host key replacement in keys.nix failed" >&2
        exit 1
      fi

      echo "Updated host key in keys.nix, rekeying secrets..."
      ragenix --rules ./config/secrets.nix -i "$identity" -r
    '';
  };

  remote = pkgs.writeShellApplication {
    name = "remote";
    runtimeInputs = [
      pkgs.rage
      pkgs.jq
      pkgs.openssh
    ];
    text = ''
      ${resolveIp}
      exec ssh -i "$identity" "root@$host_ip" "$@"
    '';
  };
}
