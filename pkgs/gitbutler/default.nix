{ pkgs, lib }:

let
  version = "0.21.0";
  build = "3133";
  baseUrl = "https://releases.gitbutler.com/releases/release/${version}-${build}";

  sources = {
    aarch64-darwin = {
      url = "${baseUrl}/macos/aarch64/GitButler.app.tar.gz";
      hash = "sha256-J4S8J4Vm2+H+zlT1PwezKl6cueXDB1Alr2TJs2S3OEY=";
    };
    x86_64-darwin = {
      url = "${baseUrl}/macos/x86_64/GitButler.app.tar.gz";
      hash = "sha256-4NFIWCUKJN/yiZelnyIc7jLhmfpa4g5SHIylrE3g3Yg=";
    };
    x86_64-linux = {
      url = "${baseUrl}/linux/x86_64/GitButler_${version}_amd64.deb";
      hash = "sha256-9HwSPm0jZE21FlQNaozdKr3ZqxoNMt13g+ERUTwyA70=";
    };
    aarch64-linux = {
      url = "${baseUrl}/linux/aarch64/GitButler_${version}_arm64.deb";
      hash = "sha256-oonaN9SlsQPEOOpI2fNb7sdMieuqX0roPS5220TksSw=";
    };
  };

  system = pkgs.stdenv.hostPlatform.system;
  source =
    sources.${system}
      or (throw "gitbutler-cli: unsupported platform '${system}'. Supported platforms: ${builtins.concatStringsSep ", " (builtins.attrNames sources)}");

  meta = {
    description = "GitButler CLI";
    homepage = "https://gitbutler.com/cli";
    license = lib.licenses.unfree;
    platforms = builtins.attrNames sources;
    mainProgram = "but";
  };
in
if pkgs.stdenv.hostPlatform.isDarwin then
  # The macOS .app bundle ships no standalone `but`; the desktop binary
  # `gitbutler-tauri` dispatches into CLI mode when invoked as `but`.
  pkgs.stdenvNoCC.mkDerivation {
    pname = "gitbutler-cli";
    inherit version meta;
    src = pkgs.fetchurl { inherit (source) url hash; };
    sourceRoot = ".";
    nativeBuildInputs = [
      pkgs.darwin.sigtool
      pkgs.darwin.cctools
    ];
    installPhase = ''
      mkdir -p $out/bin
      cp GitButler.app/Contents/MacOS/gitbutler-tauri $out/bin/but
      cp GitButler.app/Contents/MacOS/gitbutler-git-askpass $out/bin/
      # Use GitButler's bundle identifier so macOS keychain ACLs persist
      # across nix store path changes (rebuilds, version bumps)
      codesign -f -s - --identifier com.gitbutler.app $out/bin/but
      codesign -f -s - $out/bin/gitbutler-git-askpass
    '';
  }
else
  # On Linux `usr/bin/but` is a symlink to `gitbutler-tauri`; copy the real
  # binary, which dispatches into CLI mode when invoked as `but`.
  pkgs.stdenvNoCC.mkDerivation {
    pname = "gitbutler-cli";
    inherit version meta;
    src = pkgs.fetchurl { inherit (source) url hash; };
    sourceRoot = ".";
    nativeBuildInputs = [
      pkgs.dpkg
      pkgs.autoPatchelfHook
    ];
    buildInputs = [
      pkgs.stdenv.cc.cc.lib
      pkgs.openssl
      pkgs.zlib
      pkgs.dbus
    ];
    # gitbutler-tauri links GTK/WebKit for the desktop GUI, but we only run it
    # headlessly as a CLI. Ignore exactly the GUI libraries it never loads in
    # CLI mode (gitbutler-git-askpass needs only libc/libgcc_s, both provided).
    autoPatchelfIgnoreMissingDeps = [
      "libgtk-3.so.0"
      "libgdk-3.so.0"
      "libgdk_pixbuf-2.0.so.0"
      "libcairo.so.2"
      "libgobject-2.0.so.0"
      "libglib-2.0.so.0"
      "libgio-2.0.so.0"
      "libsoup-3.0.so.0"
      "libwebkit2gtk-4.1.so.0"
      "libjavascriptcoregtk-4.1.so.0"
    ];
    unpackPhase = "dpkg-deb -x $src .";
    installPhase = ''
      mkdir -p $out/bin
      cp usr/bin/gitbutler-tauri $out/bin/but
      cp usr/bin/gitbutler-git-askpass $out/bin/
    '';
  }
