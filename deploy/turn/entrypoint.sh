#!/bin/sh
set -eu

secret="$(printf '%s' "${TURN_AUTH_SECRET:-}" | tr -d '\r\n')"
case "${secret}" in
  ????????????????????????????????*) ;;
  *) echo "TURN authentication secret must contain at least 32 characters" >&2; exit 1 ;;
esac
case "${TURN_REALM:-}" in
  *[!A-Za-z0-9.-]*|'') echo "TURN_REALM must be a hostname" >&2; exit 1 ;;
esac
for address in "${TURN_EXTERNAL_IP:-}" "${TURN_RELAY_IP:-}"; do
  case "${address}" in
    *[!0-9.]*|'') echo "TURN addresses must be IPv4 literals" >&2; exit 1 ;;
  esac
done
for port in "${TURN_PORT:-}" "${TURN_MIN_PORT:-}" "${TURN_MAX_PORT:-}"; do
  case "${port}" in
    *[!0-9]*|'') echo "TURN ports must be numeric" >&2; exit 1 ;;
  esac
done

umask 077
{
  printf '%s\n' \
    "listening-port=${TURN_PORT}" \
    "listening-ip=${TURN_RELAY_IP}" \
    "relay-ip=${TURN_RELAY_IP}" \
    "external-ip=${TURN_EXTERNAL_IP}/${TURN_RELAY_IP}" \
    "min-port=${TURN_MIN_PORT}" \
    "max-port=${TURN_MAX_PORT}" \
    "realm=${TURN_REALM}" \
    "server-name=${TURN_REALM}" \
    "static-auth-secret=${secret}" \
    'use-auth-secret' \
    'fingerprint' \
    'stale-nonce=600' \
    'channel-lifetime=600' \
    'total-quota=64' \
    'user-quota=16' \
    'max-bps=1000000' \
    'bps-capacity=16000000' \
    'no-multicast-peers' \
    'no-tcp-relay' \
    'no-tls' \
    'no-software-attribute' \
    'denied-peer-ip=0.0.0.0-0.255.255.255' \
    'denied-peer-ip=10.0.0.0-10.255.255.255' \
    'denied-peer-ip=100.64.0.0-100.127.255.255' \
    'denied-peer-ip=127.0.0.0-127.255.255.255' \
    'denied-peer-ip=169.254.0.0-169.254.255.255' \
    'denied-peer-ip=172.16.0.0-172.31.255.255' \
    'denied-peer-ip=192.168.0.0-192.168.255.255' \
    'denied-peer-ip=224.0.0.0-255.255.255.255' \
    'pidfile=/run/turnserver.pid' \
    'log-file=stdout' \
    'simple-log'
} >/run/turnserver.conf

exec turnserver -c /run/turnserver.conf
