{ pkgs, craneLib }:

let
  # Include fixtures, spreadsheet regression data, and migrations alongside
  # standard Cargo sources for tests.
  src = pkgs.lib.cleanSourceWith {
    src = ./.;
    filter = path: type:
      let base = builtins.baseNameOf path;
      in (craneLib.filterCargoSources path type) || base == "fixtures" || base
      == "migrations" || base == "data_test"
      || (pkgs.lib.hasPrefix (toString ./fixtures) path)
      || (pkgs.lib.hasPrefix (toString ./migrations) path)
      || (pkgs.lib.hasPrefix (toString ./data_test) path);
  };

  # Cargo manifests only -- deps derivation hash changes only when dependencies change
  depsSrc = pkgs.lib.cleanSourceWith {
    src = ./.;
    filter = path: type:
      let base = builtins.baseNameOf path;
      in type == "directory" || base == "Cargo.toml" || base == "Cargo.lock";
  };

  # Use depsSrc (Cargo manifests only) so the vendor hash is stable across
  # source-only changes -- vendoring only needs Cargo.toml + Cargo.lock.
  cargoVendorDir = craneLib.vendorCargoDeps {
    src = depsSrc;
    cargoLock = ./Cargo.lock;
  };

  commonArgs = {
    pname = "moneymentum";
    version = "0.1.0";
    inherit src cargoVendorDir;

    nativeBuildInputs = [ pkgs.pkg-config ];

    buildInputs = [ pkgs.openssl pkgs.sqlite ]
      ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin
      [ pkgs.apple-sdk_15 ];

    RUSTFLAGS = "-D warnings";

    # Compile/test env for sqlx and reqwest in the nix sandbox. SQLX_OFFLINE is
    # set here as a derivation env var, not only in .cargo/config.toml, because
    # crane's buildDepsOnly vendors the dependency crates from a manifest-only
    # source tree (depsSrc) that omits .cargo/config.toml. Without the env var,
    # the event-store deps' compile-time `sqlx::query_file!` macros connect to
    # DATABASE_URL instead of their bundled `.sqlx/` caches and fail against the
    # empty sandbox database.
    DATABASE_URL = "sqlite::memory:";
    SQLX_OFFLINE = "true";
    SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
    NIX_SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
  };

  cargoArtifacts = craneLib.buildDepsOnly (commonArgs // { src = depsSrc; });

in {
  package = craneLib.buildPackage (commonArgs // {
    inherit cargoArtifacts;
    doCheck = true;
  });

  # CI check derivations -- lighter than buildPackage (no final link step)
  test = craneLib.cargoTest (commonArgs // { inherit cargoArtifacts; });

  clippy = craneLib.cargoClippy (commonArgs // {
    inherit cargoArtifacts;
    cargoClippyExtraArgs = "--all-targets -- -D clippy::all";
  });
}
