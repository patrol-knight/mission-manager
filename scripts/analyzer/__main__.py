import argparse
from pathlib import Path

from . import plots
from .reader import load_run
from .summary import write_summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Plots and a summary for a devtools run (data/runs/<run>).")
    parser.add_argument("runs", nargs="+", type=Path)
    args = parser.parse_args()

    for path in args.runs:
        run = load_run(path)
        outputs = [plots.device_figure(run, d) for d in run.devices()]
        outputs += [plots.ping_cdf(run), plots.webrtc_figure(run), plots.coverage_map(run)]
        write_summary(run)
        print(f"{path}: summary.md, " + ", ".join(o for o in outputs if o))


if __name__ == "__main__":
    main()
