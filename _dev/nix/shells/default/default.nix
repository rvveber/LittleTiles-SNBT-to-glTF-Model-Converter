{
    # Snowfall Lib provides a customized `lib` instance with access to your flake's library
    # as well as the libraries available from your flake's inputs.
    lib,
    # You also have access to your flake's inputs.
    inputs,

    # The namespace used for your flake, defaulting to "internal" if not set.
    namespace,

    # All other arguments come from NixPkgs. You can use `pkgs` to pull shells or helpers
    # programmatically or you may add the named attributes as arguments here.
    pkgs,
    mkShell,
    ...
}:

let
    jdk = if pkgs ? jdk21
        then pkgs.jdk21
        else if pkgs.javaPackages.compiler ? openjdk21
            then pkgs.javaPackages.compiler.openjdk21
            else pkgs.javaPackages.compiler.openjdk25;
in
mkShell {
    packages = with pkgs; [
        nodejs
        python3
        jdk
        gradle
    ];

    shellHook = ''
        export JAVA_HOME="${jdk}"
    '';
}
