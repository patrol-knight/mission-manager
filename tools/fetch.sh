#!/bin/sh
# Copies devtools recordings from the lab machine to this one, for analysis here.
#   tools/fetch.sh user@lab-machine           every run
#   tools/fetch.sh user@lab-machine <run>     one run, e.g. 20261110_093000
# REMOTE_DIR: the repo on the lab machine, relative to its home (default patrol/mission-manager).
# Only record.jsonl is copied, so results/ made here are never overwritten.
set -eu
[ $# -ge 1 ] || { sed -n 2,6p "$0" | sed 's/^# \{0,1\}//'; exit 2; }
host=$1
run=${2:-}
root=$(cd "$(dirname "$0")/.." && pwd)
remote=${REMOTE_DIR:-patrol/mission-manager}/data/runs

mkdir -p "$root/data/runs"
rsync -a --prune-empty-dirs --include='*/' --include='record.jsonl' --exclude='*' \
  "$host:$remote/${run:+$run/}" "$root/data/runs/${run:+$run/}"
echo "Copied to data/runs/${run:+$run/}; analyze with: python -m tools.analyzer data/runs/<run>"
