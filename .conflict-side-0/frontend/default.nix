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
}
