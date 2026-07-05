{ pkgs, bun2nix }:

let
  bunDeps = bun2nix.fetchBunDeps { bunNix = ./bun.nix; };

  commonArgs = {
    version = "0.1.0";
    src = ./.;
    nativeBuildInputs = [
      bun2nix.hook
      pkgs.bun
    ];
    inherit bunDeps;
    dontUseBunBuild = true;
    dontUseBunCheck = true;
    dontUseBunInstall = true;
    dontRunLifecycleScripts = true;
  };

in
{
  package = pkgs.stdenv.mkDerivation (
    commonArgs
    // {
      pname = "moneymentum-frontend";

      buildPhase = ''
        bun run build
      '';

      installPhase = ''
        cp -r dist $out
      '';

      meta = {
        description = "moneymentum frontend";
        homepage = "https://github.com/dataclique/moneymentum";
      };
    }
  );

  lint = pkgs.stdenv.mkDerivation (
    commonArgs
    // {
      pname = "moneymentum-frontend-lint";

      buildPhase = ''
        bun run lint
      '';

      installPhase = ''
        touch $out
      '';
    }
  );

  test = pkgs.stdenv.mkDerivation (
    commonArgs
    // {
      pname = "moneymentum-frontend-test";

      buildPhase = ''
        bun run test --run
      '';

      installPhase = ''
        touch $out
      '';
    }
  );

  visual-test = pkgs.stdenv.mkDerivation (
    commonArgs
    // {
      pname = "moneymentum-frontend-visual-test";

      nativeBuildInputs = commonArgs.nativeBuildInputs ++ [
        pkgs.playwright-driver.browsers
        pkgs.nodejs
      ];

      buildPhase = ''
        export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
        export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
        export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
        export PLAYWRIGHT_NODEJS_PATH="${pkgs.nodejs}/bin/node"
        bun run test:vrt
      '';

      installPhase = ''
        mkdir -p $out
        if [ -d .vrt-screenshots ]; then
          cp -r .vrt-screenshots $out/
        fi
      '';
    }
  );
}
