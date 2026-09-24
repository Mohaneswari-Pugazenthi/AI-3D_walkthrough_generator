"""Generate a synthetic floor-plan image (white background, black walls) for testing."""

from pathlib import Path

import cv2
import numpy as np


def make_sample(path: str = "data/sample_plan.png", size: int = 800) -> None:
    img = np.full((size, size, 3), 255, dtype=np.uint8)
    black = (0, 0, 0)
    t = 8  # wall thickness

    cv2.rectangle(img, (40, 40), (size - 40, size - 40), black, t)  # outer walls
    # interior walls (with gaps left as doors)
    cv2.line(img, (size // 2, 40), (size // 2, size // 2 + 100), black, t)
    cv2.line(img, (40, size // 2 + 100), (size // 2 - 120, size // 2 + 100), black, t)
    cv2.line(img, (size // 2 + 120, size // 2 + 100), (size - 40, size // 2 + 100), black, t)
    cv2.line(img, (size // 2 + 120, size // 2 + 100), (size // 2 + 120, size - 40), black, t)

    # room labels
    for label, org in [("LIVING", (90, 110)), ("KITCHEN", (470, 110)), ("BEDROOM", (480, 650))]:
        cv2.putText(img, label, org, cv2.FONT_HERSHEY_SIMPLEX, 0.8, black, 2)

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(path, img)
    print(f"Sample floor plan written to {path}")


if __name__ == "__main__":
    make_sample()
