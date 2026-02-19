#!/bin/sh

# Replace env variable in config template
envsubst '${ROSBRIDGE_URL}' \
  < /usr/share/nginx/html/config.template.js \
  > /usr/share/nginx/html/config.js

exec "$@"
