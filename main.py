"""TENIX Phase 1 CLI: python main.py <floorplan_image> [-o output_dir]"""

import argparse
import sys

from tenix.pipeline import print_report, run_pipeline


def main() -> int:
    parser = argparse.ArgumentParser(description="TENIX Phase 1: floor-plan preprocessing")
    parser.add_argument("image", help="Path to floor-plan image")
    parser.add_argument("-o", "--output", default="output", help="Output directory (default: output)")
    args = parser.parse_args()

    try:
        report = run_pipeline(args.image, args.output)
    except (FileNotFoundError, ValueError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print_report(report)
    print(f"\nOK: processed image saved to {report['outputs']['binary']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
