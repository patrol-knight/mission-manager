import argparse
from pathlib import Path

from . import plots
from .reader import load_run
from .summary import write_summary


def main() -> None:
    parser = argparse.ArgumentParser(description="summary.csv and figures for devtools runs, into <run>/results/.")
    parser.add_argument("runs", nargs="+", type=Path, help="data/runs/<run> folders")
    args = parser.parse_args()

    for path in args.runs:
        run = load_run(path)
        outputs = [write_summary(run)] + [plots.device_figure(run, d) for d in run.devices()]
        outputs += [plots.traffic_figure(run), plots.rtt_cdf(run), plots.video_figure(run), plots.coverage_map(run)]
        print(f"{run.results}: " + ", ".join(o for o in outputs if o))


if __name__ == "__main__":
    main()
