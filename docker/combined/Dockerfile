# Combined image: the web frontend (nginx) and the API (uvicorn) in one
# container, for the Unraid Community Applications template
# (unraid/the-logbook.xml), which can name only one image. Owner decision of
# 2026-11-01; see docs/KNOWN_LIMITATIONS.md, "Unraid Community Apps Template".
#
# BUILD WITH BAKE, from the repository root:
#
#   docker buildx bake -f docker-bake.hcl combined --load
#
# `backend-image` and `frontend-image` below are not registry images. They are
# bake `target:` contexts (docker-bake.hcl) that resolve to the finished
# production stages of backend/Dockerfile and frontend/Dockerfile, so this
# image reuses those builds rather than repeating them: the same Python and
# Node versions, the same dependencies, the same appuser, the same static
# bundle and the same nginx site configuration. A plain `docker build` of this
# file fails, because it has no way to supply them.
#
# MySQL and Redis are not inside: they stay separate containers, as in every
# other deployment.
#
# The separate backend and frontend images and the compose stacks that run
# them are unchanged by this file.

FROM frontend-image AS frontend

FROM backend-image AS combined

USER root

# Debian's nginx, on the backend image's own base, because the backend's
# Python and system libraries are the larger half and cannot move to alpine.
# Logs go to the container's stdout/stderr, as in the official nginx images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default \
    && ln -sf /dev/stdout /var/log/nginx/access.log \
    && ln -sf /dev/stderr /var/log/nginx/error.log \
    && mkdir -p /tmp/nginx \
    && chown appuser:appuser /tmp/nginx

COPY nginx.conf /etc/nginx/nginx.conf

# The built bundle, plus the 50x.html the nginx base image ships beside it,
# which the site configuration's error_page names.
COPY --from=frontend /usr/share/nginx/html /usr/share/nginx/html

# The frontend's own site configuration, with the only two things that differ
# in one container rewritten: nginx listens on 3000 (an unprivileged port, as
# it runs as appuser) and reaches the API on loopback instead of at a host
# called `backend`. The greps fail the build if a later edit to
# frontend/nginx.conf leaves either rewrite matching nothing.
COPY --from=frontend /etc/nginx/conf.d/default.conf /tmp/frontend-site.conf
RUN sed -e 's/^\([[:space:]]*\)listen 80;/\1listen 3000;/' \
        -e 's#http://backend:3001#http://127.0.0.1:3001#g' \
        /tmp/frontend-site.conf > /etc/nginx/conf.d/default.conf \
    && rm /tmp/frontend-site.conf \
    && grep -q '^[[:space:]]*listen 3000;' /etc/nginx/conf.d/default.conf \
    && ! grep -q 'listen 80;' /etc/nginx/conf.d/default.conf \
    && ! grep -q 'backend:3001' /etc/nginx/conf.d/default.conf

COPY --chmod=0755 entrypoint.sh /usr/local/bin/logbook-entrypoint

USER appuser

# Validates the rewritten configuration as the user that will run it, so a
# missing module or an unwritable path fails here rather than at first start.
RUN nginx -t

# 3000 is the web interface; /api is proxied to the API on 127.0.0.1:3001,
# which is not reachable from outside the container. (3001 still appears in
# `docker inspect` because the backend image exposes it; nothing listens on it
# beyond loopback here.)
EXPOSE 3000

# Through nginx to the backend's /health, so it passes only when both halves
# answer. Same timings as the backend image: first start runs migrations.
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD python -c "import requests; r = requests.get('http://127.0.0.1:3000/health', timeout=5); exit(0 if r.status_code == 200 else 1)"

CMD ["/usr/local/bin/logbook-entrypoint"]
