# Build definitions for the published images (docker buildx bake).
#
# The separate backend and frontend images are still built by their own
# Dockerfiles and the compose files exactly as before; nothing here changes
# them. This file exists for the combined image the Unraid Community
# Applications template runs (unraid/the-logbook.xml), which is assembled from
# those two images rather than from a second copy of their build steps:
#
#   docker buildx bake -f docker-bake.hcl combined          # build for this machine
#   docker buildx bake -f docker-bake.hcl combined --load   # ...and load it
#
# Name the file with -f. Without it, bake also reads docker-compose.yml, whose
# required secrets (ENCRYPTION_KEY, ...) make it refuse to start, and whose
# services would be merged in as targets of their own.
#
# `target:` contexts hand the finished production stage of each Dockerfile to
# docker/combined/Dockerfile under a name it can `FROM` / `COPY --from`. That
# needs BuildKit's bake, which a plain `docker build` cannot drive; the release
# workflow (.github/workflows/release-image.yml) builds it the same way.

variable "IMAGE" {
  # Matches <Repository> in unraid/the-logbook.xml and IMAGE in the release
  # workflow; tests/test_combined_image.py holds the three together.
  default = "ghcr.io/thegspiro/the-logbook"
}

variable "TAG" {
  default = "local"
}

# Comma-separated, e.g. "linux/amd64,linux/arm64". Empty builds for the host.
# Every target takes the same list: a `target:` context must be built for each
# platform the image that consumes it is built for.
variable "PLATFORMS" {
  default = ""
}

function "platform_list" {
  params = [value]
  result = value == "" ? [] : split(",", value)
}

group "default" {
  targets = ["combined"]
}

target "backend-production" {
  context    = "backend"
  dockerfile = "Dockerfile"
  target     = "production"
  platforms  = platform_list(PLATFORMS)
}

target "frontend-production" {
  # The frontend builds from the repository root: see frontend/Dockerfile.
  context    = "."
  dockerfile = "frontend/Dockerfile"
  target     = "production"
  platforms  = platform_list(PLATFORMS)
}

# The release workflow loads docker/metadata-action's bake files after this
# one, which redefine this target with the release's tags and OCI labels. A
# local build keeps the default tag below. The tag lives here, not on
# "combined", because a target's own attribute overrides an inherited one and
# would discard the release tags.
target "docker-metadata-action" {
  tags = ["${IMAGE}:${TAG}"]
}

target "combined" {
  inherits   = ["docker-metadata-action"]
  context    = "docker/combined"
  dockerfile = "Dockerfile"
  contexts = {
    "backend-image"  = "target:backend-production"
    "frontend-image" = "target:frontend-production"
  }
  platforms = platform_list(PLATFORMS)
}
