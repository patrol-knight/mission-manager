FROM alpine:3.20
RUN apk add --no-cache chrony
COPY chrony.conf /etc/chrony/chrony.conf
EXPOSE 123/udp
# -x: never adjust the clock; the host keeps it synced.
CMD ["chronyd", "-d", "-x", "-f", "/etc/chrony/chrony.conf"]
