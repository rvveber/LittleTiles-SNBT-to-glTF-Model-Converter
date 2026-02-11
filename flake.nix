{
  description = "LittleTiles.net development environment";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs";
    snowfall-lib = {
        url = "github:snowfallorg/lib";
        inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = inputs:
        inputs.snowfall-lib.mkFlake {
            inherit inputs;
            src = ./.;

            # Configure Snowfall Lib, all of these settings are optional.
            snowfall = {
                # Tell Snowfall Lib to look in the `./nix/` directory for your
                # Nix files.
                root = ./_dev/nix;

                # Choose a namespace to use for your flake's packages, library,
                # and overlays.
                namespace = "gltf-littletiles";

                # Add flake metadata that can be processed by tools like Snowfall Frost.
                meta = {
                    # A slug to use in documentation when displaying things like file paths.
                    name = "gltf-littletiles development";

                    # A title to show for your flake, typically the name.
                    title = "GLTF LittleTiles Development";
                };
            };
        };
}