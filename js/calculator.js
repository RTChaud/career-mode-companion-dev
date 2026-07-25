/**
 * potential.js — automatic potential calculation
 * ================================================================
 * Implements the potential estimator using the spreadsheet supplied
 * for this feature (Potential_Calculator.xlsx). The spreadsheet is a
 * lookup table of estimated market values, keyed by:
 *   position group (ST, RW/LW, CAM, CM, RB/LB, CB, GK)
 *     -> age (16, 18, 20)
 *       -> potential anchor (85, 88, 91)
 *         -> 5 market values, one per overall anchor (60, 65, 70, 75, 80)
 *
 * POTENTIAL_TABLE below is that spreadsheet, transcribed verbatim —
 * every number is exactly what was in the sheet. Nothing has been
 * smoothed, rounded, or normalised.
 *
 * ESTIMATION METHOD
 * ----------------------------------------------------------------
 * 1. For each potential anchor (85, 88, 91), build an age-adjusted
 *    row of 5 values (one per overall anchor):
 *      - age <= 16          -> the age-16 row, unchanged
 *      - 16 < age < 18       -> interpolate between the age-16 and
 *                              age-18 rows (covers age 17)
 *      - age === 18          -> the age-18 row, unchanged
 *      - 18 < age < 20       -> interpolate between the age-18 and
 *                              age-20 rows (covers age 19)
 *      - age >= 20           -> extrapolate from the age-18 -> age-20
 *                              trend (age 20 lands exactly on the
 *                              age-20 row; age 21 and above continue
 *                              that same trend, per the brief)
 * 2. Interpolate that age-adjusted row across all five overall anchors
 *    (60/65/70/75/80) at the player's actual Overall, to get a single
 *    market value for each potential anchor: value85, value88, value91.
 *    Market value grows non-linearly with Overall, so this uses
 *    monotonic cubic (Fritsch–Carlson/PCHIP-style) Hermite interpolation
 *    over the natural log of the five values, converted back with
 *    Math.exp() — this follows the curve of the data without the
 *    oscillation, dips, or negative values a plain cubic spline could
 *    introduce. An Overall at or beyond the ends of the anchor range is
 *    clamped to the nearest anchor (60 or 80), since the sheet defines
 *    no values beyond that range to extrapolate from.
 * 3. Interpolate the player's actual Value between value85/value88/
 *    value91 to estimate their Potential:
 *      - Value below value85              -> extrapolate downward from
 *                                            the 85/88 anchors using the
 *                                            same formula, allowing a
 *                                            result below 85
 *      - value85 <= Value < value88      -> interpolate in [85, 88]
 *      - value88 <= Value < value91      -> interpolate in [88, 91]
 *      - Value >= value91                -> 91
 *      - value88 === value91 (anchors identical) -> always 88, the
 *        conservative lower bound, since the sheet gives no way to
 *        tell 88 and 91 apart in that case.
 * 4. Floor the result with Math.floor(), clamp it to 1–91, and never
 *    return a value below the player's current Overall.
 * ================================================================
 */
const PotentialCalculator = (() => {

  // ---- The spreadsheet, transcribed exactly (see module comment). ----
  const POTENTIAL_TABLE = {
    'ST': {
      16: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [675000, 1700000, 3100000, 10000000, 25000000],
          88: [850000, 1900000, 3400000, 11000000, 38000000],
          91: [1000000, 2500000, 4300000, 12000000, 38000000]
        }
      },
      18: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [675000, 1700000, 3200000, 10500000, 25000000],
          88: [850000, 2000000, 3500000, 11500000, 38500000],
          91: [1000000, 2500000, 4400000, 12500000, 38500000]
        }
      },
      20: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [700000, 1800000, 3300000, 10500000, 27000000],
          88: [875000, 2000000, 3600000, 11500000, 40000000],
          91: [1100000, 2500000, 4500000, 13000000, 40000000]
        }
      }
    },
    'RW/LW': {
      16: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [675000, 1700000, 3100000, 10000000, 24500000],
          88: [850000, 1900000, 3400000, 11000000, 37500000],
          91: [1000000, 2400000, 4300000, 12000000, 37500000]
        }
      },
      18: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [675000, 1700000, 3200000, 10000000, 25500000],
          88: [850000, 2000000, 3500000, 11000000, 38000000],
          91: [1000000, 2500000, 4400000, 12500000, 38000000]
        }
      },
      20: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [700000, 1700000, 3300000, 10500000, 27000000],
          88: [875000, 2000000, 3600000, 11500000, 40000000],
          91: [1100000, 2500000, 4500000, 12500000, 40000000]
        }
      }
    },
    'CAM': {
      16: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [675000, 1700000, 3100000, 10000000, 24500000],
          88: [850000, 1900000, 3400000, 11000000, 37500000],
          91: [1000000, 2400000, 4300000, 12000000, 37500000]
        }
      },
      18: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [675000, 1700000, 3200000, 10000000, 25500000],
          88: [850000, 2000000, 3500000, 11000000, 38000000],
          91: [1000000, 2500000, 4400000, 12500000, 38000000]
        }
      },
      20: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [700000, 1700000, 3300000, 10500000, 27000000],
          88: [875000, 2000000, 3600000, 11500000, 40000000],
          91: [1100000, 2500000, 4500000, 12500000, 40000000]
        }
      }
    },
    'CM': {
      16: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [650000, 1700000, 3100000, 10000000, 24500000],
          88: [850000, 1900000, 3400000, 11000000, 37500000],
          91: [1000000, 2400000, 4300000, 12000000, 37500000]
        }
      },
      18: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [675000, 1700000, 3200000, 10000000, 25000000],
          88: [850000, 1900000, 3500000, 11000000, 38000000],
          91: [1000000, 2500000, 4300000, 12000000, 38000000]
        }
      },
      20: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [700000, 1700000, 3300000, 10500000, 27000000],
          88: [875000, 2000000, 3600000, 11500000, 39500000],
          91: [1000000, 2500000, 4500000, 12500000, 39500000]
        }
      }
    },
    'RB/LB': {
      16: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [650000, 1600000, 3000000, 9500000, 23000000],
          88: [825000, 1900000, 3300000, 10500000, 35500000],
          91: [1000000, 2400000, 4200000, 11500000, 35500000]
        }
      },
      18: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [650000, 1600000, 3000000, 9500000, 23500000],
          88: [825000, 1900000, 3300000, 10500000, 36500000],
          91: [1000000, 2400000, 4200000, 12000000, 36500000]
        }
      },
      20: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [675000, 1700000, 3200000, 10000000, 25000000],
          88: [850000, 1900000, 3500000, 11000000, 38000000],
          91: [1000000, 2500000, 4300000, 12000000, 38000000]
        }
      }
    },
    'CB': {
      16: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [625000, 1600000, 2900000, 9500000, 22000000],
          88: [825000, 1800000, 3200000, 10500000, 35000000],
          91: [1000000, 2400000, 4100000, 11500000, 35000000]
        }
      },
      18: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [650000, 1600000, 3000000, 9500000, 23000000],
          88: [825000, 1900000, 3300000, 10500000, 35500000],
          91: [1000000, 2400000, 4200000, 11500000, 35500000]
        }
      },
      20: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [650000, 1700000, 3100000, 10000000, 24500000],
          88: [850000, 1900000, 3400000, 11000000, 37000000],
          91: [1000000, 2400000, 4300000, 12000000, 37000000]
        }
      }
    },
    'GK': {
      16: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [600000, 1500000, 2700000, 8500000, 19000000],
          88: [775000, 1700000, 3000000, 9500000, 32000000],
          91: [950000, 2300000, 3900000, 10500000, 32000000]
        }
      },
      18: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [600000, 1500000, 2800000, 9000000, 20000000],
          88: [800000, 1800000, 3100000, 10000000, 33000000],
          91: [975000, 2300000, 3900000, 11000000, 33000000]
        }
      },
      20: {
        overalls: [60, 65, 70, 75, 80],
        potentials: {
          85: [625000, 1600000, 2900000, 9000000, 21500000],
          88: [800000, 1800000, 3200000, 10000000, 34500000],
          91: [1000000, 2300000, 4100000, 11000000, 34500000]
        }
      }
    }
  };

  /**
   * Maps every position the app supports to one of the 7 spreadsheet
   * position groups. Kept in one place so it's easy to amend.
   */
  function mapPositionToGroup(position) {
    const map = {
      GK: 'GK',
      RB: 'RB/LB', LB: 'RB/LB',
      CB: 'CB',
      CM: 'CM',
      CAM: 'CAM',
      RW: 'RW/LW', LW: 'RW/LW',
      ST: 'ST',
    };
    return map[position] || null;
  }

  /** Linear interpolation of y at x, between (x0,y0) and (x1,y1). */
  function lerp(x0, y0, x1, y1, x) {
    if (x1 === x0) return y0;
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }

  /** Elementwise lerp/extrapolation of two equal-length arrays. */
  function lerpRow(rowA, ageA, rowB, ageB, age) {
    return rowA.map((v, i) => lerp(ageA, v, ageB, rowB[i], age));
  }

  /**
   * Builds the age-adjusted row of 5 overall-anchor values for a given
   * position group and potential anchor, per the rules in the module
   * comment (interpolating 17/19, extrapolating 20+).
   */
  function getAgeAdjustedRow(group, potential, age) {
    const ages = POTENTIAL_TABLE[group];
    const row16 = ages[16].potentials[potential];
    const row18 = ages[18].potentials[potential];
    const row20 = ages[20].potentials[potential];

    if (age <= 16) return row16.slice();
    if (age < 18) return lerpRow(row16, 16, row18, 18, age);
    if (age === 18) return row18.slice();
    if (age < 20) return lerpRow(row18, 18, row20, 20, age);
    // age >= 20: extrapolate from the 18 -> 20 trend (age 20 itself
    // lands exactly on row20; age 21 continues the same trend).
    return lerpRow(row18, 18, row20, 20, age);
  }

  /**
   * Monotonic cubic (Fritsch–Carlson) Hermite interpolation across all
   * five Overall anchors, evaluated on the natural log of the values
   * and converted back with Math.exp(). Market value grows non-linearly
   * with Overall; interpolating in log-space with a monotone spline
   * models that curve without the oscillation, dips, or negative values
   * a plain (non-monotone) cubic spline could introduce.
   */
  function monotonicCubicLogInterpolate(xs, ys, x) {
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    // Exact anchor hit: return the original value untouched rather than
    // round-tripping it through Math.log/Math.exp, whose tiny floating-
    // point noise (~1e-9) could otherwise push it just to the wrong
    // side of a Math.floor() boundary later on.
    for (let i = 0; i < n; i++) {
      if (x === xs[i]) return ys[i];
    }

    const logY = ys.map(v => Math.log(v));

    // Secant slope (in log-space) of each of the four segments.
    const h = new Array(n - 1);
    const delta = new Array(n - 1);
    for (let i = 0; i < n - 1; i++) {
      h[i] = xs[i + 1] - xs[i];
      delta[i] = (logY[i + 1] - logY[i]) / h[i];
    }

    // Initial tangent at each anchor: the secant itself at the two
    // endpoints, the average of the adjacent secants in between.
    const m = new Array(n);
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];
    for (let i = 1; i < n - 1; i++) {
      m[i] = (delta[i - 1] + delta[i]) / 2;
    }

    // A flat segment forces both of its tangents to zero.
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
      }
    }

    // Fritsch–Carlson monotonicity constraint: rescale any tangent
    // pair that would otherwise let the spline overshoot and oscillate.
    for (let i = 0; i < n - 1; i++) {
      if (delta[i] === 0) continue;
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const s = alpha * alpha + beta * beta;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[i] = tau * alpha * delta[i];
        m[i + 1] = tau * beta * delta[i];
      }
    }

    // Locate the segment containing x, then evaluate the cubic Hermite.
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;

    const hk = h[k];
    const t = (x - xs[k]) / hk;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const logResult = h00 * logY[k] + h10 * hk * m[k] + h01 * logY[k + 1] + h11 * hk * m[k + 1];
    return Math.exp(logResult);
  }

  /**
   * Interpolates an age-adjusted row across all five overall anchors
   * (60/65/70/75/80) at the player's actual Overall, using monotonic
   * cubic interpolation in log-space (see monotonicCubicLogInterpolate).
   * Clamps to the nearest anchor if Overall is outside 60–80.
   */
  function valueAtOverall(group, age, overallAnchors, row, overall) {
    return monotonicCubicLogInterpolate(overallAnchors, row, overall);
  }

  /**
   * @param {{age:number, overall:number, position:string, valueGBP:number}} input
   * @returns {{success:boolean, potential?:number, message?:string}}
   */
  function calculate({ age, overall, position, valueGBP }) {
    const group = mapPositionToGroup(position);
    if (!group) {
      return { success: false, message: 'This position isn\u2019t recognised for potential calculation.' };
    }

    const overallAnchors = POTENTIAL_TABLE[group][16].overalls;

    const row85 = getAgeAdjustedRow(group, 85, age);
    const row88 = getAgeAdjustedRow(group, 88, age);
    const row91 = getAgeAdjustedRow(group, 91, age);

    const value85 = valueAtOverall(group, age, overallAnchors, row85, overall);
    const value88 = valueAtOverall(group, age, overallAnchors, row88, overall);
    const value91 = valueAtOverall(group, age, overallAnchors, row91, overall);

    let potential;

    if (value88 === value91) {
      // Anchors identical: no way to distinguish 88 from 91, so always
      // report the conservative lower bound, regardless of Value.
      potential = 88;
    } else if (valueGBP >= value91) {
      potential = 91;
    } else if (valueGBP >= value88) {
      potential = (value91 === value88)
        ? 88
        : 88 + (91 - 88) * (valueGBP - value88) / (value91 - value88);
    } else {
      // Below the 88 anchor — including below value85 — extrapolate
      // using the same interpolation formula, letting the result fall
      // below 85 rather than refusing to calculate.
      potential = (value88 === value85)
        ? 85
        : 85 + ((valueGBP - value85) / (value88 - value85)) * 3;
    }

    potential = Math.floor(potential);
    potential = Math.min(Math.max(potential, 1), 91); // stay within 1–91
    potential = Math.max(potential, overall); // never below current Overall

    return { success: true, potential };
  }

  return { calculate, mapPositionToGroup, POTENTIAL_TABLE };
})();
