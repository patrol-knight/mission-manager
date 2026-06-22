#!/bin/sh

envsubst '${API_BASE_URL} ${WS_URL}' \
  < /usr/share/nginx/html/config.template.js \
  > /usr/share/nginx/html/config.js

exec "$@"
