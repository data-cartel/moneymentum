{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    flake-utils.url = "github:numtide/flake-utils";

    git-hooks.url = "github:cachix/git-hooks.nix";
    git-hooks.inputs.nixpkgs.follows = "nixpkgs";

    devenv.url = "github:cachix/devenv";
    devenv.inputs = {
      nixpkgs.follows = "nixpkgs";
      git-hooks.follows = "git-hooks";
    };

    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";

    crane.url = "github:ipetkov/crane";

    ragenix.url = "github:yaxitech/ragenix";
    ragenix.inputs.nixpkgs.follows = "nixpkgs";

    disko.url = "github:nix-community/disko";
    disko.inputs.nixpkgs.follows = "nixpkgs";

    nixos-anywhere.url = "github:nix-community/nixos-anywhere";
    nixos-anywhere.inputs.nixpkgs.follows = "nixpkgs";

    deploy-rs.url = "github:serokell/deploy-rs";
    deploy-rs.inputs.nixpkgs.follows = "nixpkgs";

    bun2nix.url = "github:nix-community/bun2nix?tag=2.0.7";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";

    # The fund Solana program. Its toolchain pins versions this monorepo
    # cannot use, so it stays in its own repository; all we consume is its
    # `packages.idl` output (the Anchor IDL json client bindings are
    # generated from). Pinned to the feat/idl-flake-output head until
    # dataclique/fund#22 merges, then this can track the default branch.
    fund.url =
      "github:dataclique/fund/d6e791b4e527da86f8a7da62039aafa2ca98d2f3";
  };

  outputs = { self, nixpkgs, flake-utils, git-hooks, devenv, rust-overlay, crane
    , ragenix, disko, nixos-anywhere, deploy-rs, bun2nix, fund, ... }@inputs:
    {
      nixosConfigurations.moneymentum = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";

        modules =
          [ disko.nixosModules.disko ragenix.nixosModules.default ./os.nix ];
      };

      deploy = (import ./deploy.nix { inherit deploy-rs self; }).config;
    } // flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
          config.allowUnfreePredicate = pkg:
            builtins.elem (pkgs.lib.getName pkg) [
              "terraform"
              "gitbutler-cli"
            ];
        };

        rustToolchain = pkgs.rust-bin.stable.latest.default;
        craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;
        rustPkgs = pkgs.callPackage ./rust.nix { inherit craneLib; };

        gitbutler-cli = import ./pkgs/gitbutler {
          inherit pkgs;
          inherit (pkgs) lib;
        };

        frontendPkgs = pkgs.callPackage ./frontend {
          bun2nix = bun2nix.packages.${system}.default;
        };

        infraPkgs =
          import ./infra { inherit pkgs ragenix nixos-anywhere system; };

        deployPkgs =
          (import ./deploy.nix { inherit deploy-rs self; }).wrappers {
            inherit pkgs infraPkgs;
            localSystem = system;
          };

        hooks = {
          # Nix
          nil.enable = true;
          nixfmt-classic.enable = true;

          # TypeScript
          eslint = {
            enable = true;
            files = "^frontend/.*\\.(ts|tsx|js|jsx)$";
            entry =
              "${pkgs.bash}/bin/bash -c 'cd frontend && ${pkgs.bun}/bin/bun run lint'";
            pass_filenames = false;
          };
          prettier = {
            enable = true;
            excludes = [ "\\.md$" ];
          };

          # TOML
          taplo.enable = true;

          # Markdown
          denofmt = {
            enable = true;
            name = "denofmt";
            entry = "${pkgs.deno}/bin/deno fmt";
            files = "\\.md$";
            pass_filenames = true;
          };

          # Rust - custom entry to avoid git-hooks.nix/nixpkgs version mismatch
          rustfmt = {
            enable = true;
            entry = "${rustToolchain}/bin/cargo fmt --";
            files = "\\.rs$";
            pass_filenames = true;
          };
        };
        hooksForChecks = hooks // {
          eslint = hooks.eslint // {
            # The CI frontend job runs eslint inside the frontend shell with Bun
            # dependencies installed. Keeping eslint in this pure Nix hook check
            # forces a cold bun2nix dependency build and duplicates that gate.
            enable = false;
          };
        };

        deps = with pkgs; [ cacert openssl.dev pkg-config sqlite.dev ];

        frontendShell = devenv.lib.mkShell {
          inherit inputs pkgs;
          modules = [{
            languages.javascript = {
              enable = true;
              directory = "frontend";
              bun = {
                enable = true;
                install.enable = true;
              };
            };

            git-hooks = { inherit hooks; };
          }];
        };

        devShell = devenv.lib.mkShell {
          inherit inputs pkgs;
          modules = [
            ({ config, ... }: {
              # https://devenv.sh/reference/options/
              packages = with pkgs;
                deps ++ [
                  git
                  gitbutler-cli
                  ragenix.packages.${system}.default
                  sqlx-cli
                  doctl
                  infraPkgs.remote
                  deployPkgs.deployNixos
                  deployPkgs.deployService
                  deployPkgs.deployServer
                  deployPkgs.deployFrontend
                ];

              languages = {
                nix.enable = true;
                javascript = {
                  enable = true;
                  directory = "frontend";
                  bun = {
                    enable = true;
                    install.enable = true;
                  };
                };

                rust = {
                  enable = true;
                  toolchain.rustc = rustToolchain;
                  toolchain.cargo = rustToolchain;
                  toolchain.rustfmt = rustToolchain;
                  toolchain.clippy = rustToolchain;
                };
              };

              # DATABASE_URL is read by sqlx for compile-time query verification
              # and by migration tooling. Runtime config uses database_url.
              # PATH so git-hooks:install finds git (common macOS paths; profile has git too).
              env = {
                DATABASE_URL = "sqlite:./moneymentum.db?mode=rwc";
                PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
                # The fund program's Anchor IDL, for generating client
                # bindings (anchor-lang declare_program! reads it at
                # compile time).
                FUND_IDL = "${fund.packages.${system}.idl}/idl/fund.json";
              };

              # Use pre-commit instead of git-hooks
              git-hooks = { inherit hooks; };

              difftastic.enable = true;
              cachix.enable = true;
            })
          ];
        };

      in {
        devShells.default = devShell;
        devShells.frontend = frontendShell;

        checks = {
          git-hooks = git-hooks.lib.${system}.run {
            hooks = hooksForChecks;
            src = self;
          };
        };
        packages = {
          default = rustPkgs.package;
          moneymentum = rustPkgs.package;
          moneymentum-test = rustPkgs.test;
          moneymentum-clippy = rustPkgs.clippy;

          inherit gitbutler-cli;

          frontend = frontendPkgs.package;
          frontend-lint = frontendPkgs.lint;
          frontend-test = frontendPkgs.test;

          resolveIp = pkgs.writeShellApplication {
            name = "resolve-ip";
            runtimeInputs = [ pkgs.rage pkgs.jq ];
            text = ''
              ${infraPkgs.resolveIp}
              echo "$host_ip"
            '';
          };

          inherit (infraPkgs)
            tfInit tfPlan tfApply tfImport tfEditVars tfCreateVars tfRekey rekey
            bootstrap remote;
          inherit (deployPkgs)
            deployNixos deployService deployServer deployFrontend;
        };
      });

  nixConfig = {
    extra-substituters =
      [ "https://devenv.cachix.org" "https://nix-community.cachix.org" ];
    extra-trusted-public-keys = [
      "devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw="
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
    allow-unfree = true;
  };
}
