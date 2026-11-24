#!/bin/sh
# Builds the documentation site into docs-site/build/site, and the nginx
# headers snippet that allows its inline scripts into docs-site/build/nginx.
#
# MkDocs reads one directory, so docs/, wiki/ and the site's own pages are
# first copied into docs-site/build/content with their repository layout kept;
# hooks/repo_links.py relies on that layout to translate links. Nothing under
# docs/ or wiki/ is modified.
#
# Usage: sh docs-site/build.sh [--stage-only]
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname -- "$here")
content="$here/build/content"

for dir in docs wiki; do
    if [ ! -d "$root/$dir" ]; then
        echo "build.sh: $root/$dir is missing" >&2
        exit 1
    fi
done

rm -rf "$here/build"
mkdir -p "$content"
cp -R "$root/docs" "$content/docs"
cp -R "$root/wiki" "$content/wiki"
cp -R "$here/content/." "$content/"
cp "$here/nav/root.nav.yml" "$content/.nav.yml"
cp "$here/nav/docs.nav.yml" "$content/docs/.nav.yml"
cp "$here/nav/wiki.nav.yml" "$content/wiki/.nav.yml"

if [ "${1:-}" = "--stage-only" ]; then
    exit 0
fi

mkdocs build --config-file "$here/mkdocs.yml"
python3 "$here/csp.py" "$here/build/site" "$here/nginx/security-headers.conf" \
    "$here/build/nginx/security-headers.conf"
