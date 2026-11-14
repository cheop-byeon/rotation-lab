"""Crop catalog, climate-driven crop suitability, and rotation ranking.

Crop parameters are planning-grade approximations compiled from FAO-56
(crop coefficients), FAO Irrigation & Drainage Paper 33 and common extension
guidance for thermal time. They vary with variety and region: validate them
with a local agronomist before relying on a ranking.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, timedelta
from statistics import mean, median

from .agro import Climate, quantile, r1


@dataclass(frozen=True)
class Crop:
    name: str
    family: str
    base_c: float          # base temperature for GDD
    gdd: float             # GDD (above base) from sowing to maturity / first harvest
    sow_c: float           # 7-day mean air temperature needed before sowing
    frost_tolerant: bool   # tolerates light frost (~ −3 °C) once established
    heat_limit_c: float    # daily max above which heat stress is counted
    kc: float              # season-average crop coefficient (FAO-56)
    waterlog_sensitive: bool
    n_fixing: bool = False
    perennial: bool = False
    note: str = ""


CROPS: dict[str, Crop] = {c.name: c for c in [
    Crop("Barley", "Cereal", 0, 1350, 5, True, 32, 0.80, False, note="Spring barley; short season, Nordic staple."),
    Crop("Oats", "Cereal", 0, 1450, 5, True, 30, 0.80, False, note="Tolerates wetter, acidic soils."),
    Crop("Spring wheat", "Cereal", 0, 1550, 5, True, 32, 0.85, False, note="Needs a longer, warmer season than barley."),
    Crop("Field pea", "Legume", 4, 1100, 6, True, 30, 0.85, True, True, note="Fixes nitrogen; break crop for cereal diseases."),
    Crop("Faba bean", "Legume", 0, 1600, 5, True, 28, 0.90, False, True, note="High-protein legume; dislikes heat at flowering."),
    Crop("Oilseed rape", "Brassica", 5, 1150, 7, True, 30, 0.85, False, note="Spring type. Keep ≥3 years between brassicas (clubroot)."),
    Crop("Potato", "Solanaceae", 5, 950, 8, False, 29, 0.90, True, note="Frost-sensitive; long return interval against blight/nematodes."),
    Crop("Grass–clover ley", "Forage", 5, 700, 5, True, 32, 0.90, False, True, True, note="Perennial forage; builds soil organic matter."),
    Crop("Silage maize", "Warm cereal", 10, 1100, 10, False, 35, 0.95, False, note="C4 crop; needs warm summers."),
    Crop("Grain maize", "Warm cereal", 10, 1450, 10, False, 35, 1.00, False, note="C4 crop; long warm season."),
    Crop("Soybean", "Legume", 10, 1250, 12, False, 35, 0.90, True, True, note="Warm-season legume."),
    Crop("Sorghum", "Warm cereal", 10, 1500, 15, False, 38, 0.85, False, note="Heat- and drought-tolerant C4 cereal."),
    Crop("Sunflower", "Composite", 6, 1500, 8, False, 35, 0.85, False, note="Deep-rooted; tolerates dry spells."),
]}

GOALS = ["Soil health", "Water resilience", "Diversity", "Yield stability"]

DEFAULT_ROTATIONS = [
    {"name": "Cereal baseline", "years": ["Barley", "Oats", "Barley"]},
    {"name": "Legume break", "years": ["Field pea", "Barley", "Oats"]},
    {"name": "Forage and oilseed", "years": ["Grass–clover ley", "Oilseed rape", "Barley"]},
]


# ---------------------------------------------------------------- suitability
def _crop_season(c: Climate, crop: Crop, year: int) -> dict | None:
    days = c.season_days(year)
    threshold = -3.0 if crop.frost_tolerant else 0.0
    mid = len(days) // 2
    spring_frosts = [i for i, d in enumerate(days[:mid]) if (t := c.val(c.tmin, d)) is not None and t <= threshold]
    earliest = spring_frosts[-1] + 1 if spring_frosts else 0
    # Sow once the 7-day running mean reaches the sowing temperature after the last damaging frost.
    sow = None
    for i in range(max(earliest, 6), len(days) - 30):
        window = [c.val(c.tmean, days[i - k]) for k in range(7)]
        rain10 = sum(c.val(c.prec, days[i - k]) or 0 for k in range(10))
        soil = c.val(c.gwr, days[i])
        moist = rain10 >= 15 or (soil is not None and soil >= 0.5)  # rain-season onset in the tropics
        if None not in window and mean(window) >= crop.sow_c and moist:
            sow = i
            break
    if sow is None:
        return {"sow": None, "matured": False}
    gdd = rain = et0 = 0.0
    heat = 0
    matured_at = None
    for i in range(sow, len(days)):
        d = days[i]
        tmin, tmean, tmax = c.val(c.tmin, d), c.val(c.tmean, d), c.val(c.tmax, d)
        if i > mid and tmin is not None and tmin <= threshold:
            break  # killing frost in autumn
        gdd += max(0.0, (tmean or crop.base_c) - crop.base_c)
        rain += c.val(c.prec, d) or 0
        et0 += c.val(c.et0, d) or 0
        heat += 1 if tmax is not None and tmax >= crop.heat_limit_c else 0
        if gdd >= crop.gdd:
            matured_at = i
            break
    end = matured_at if matured_at is not None else i
    need = crop.kc * et0
    return {"sow": sow, "matured": matured_at is not None, "cycle_days": end - sow + 1, "gdd": gdd,
            "rain": rain, "need": need, "ratio": rain / need if need > 0 else 1.0, "heat": heat}


def crop_suitability(c: Climate, irrigation: str = "Unknown") -> list[dict]:
    seasons = c.complete_seasons()
    start = c.season_start(c.season_of(c.last))
    out = []
    for crop in CROPS.values():
        runs = [r for y in seasons if (r := _crop_season(c, crop, y)) is not None]
        sown = [r for r in runs if r["sow"] is not None]
        reliability = sum(r["matured"] for r in runs) / len(runs) if runs else 0.0
        ratio = median([r["ratio"] for r in sown]) if sown else 0.0
        heat = mean([r["heat"] for r in sown]) if sown else 0.0
        water_score = min(1.0, ratio)
        if irrigation == "Yes":
            water_score = 1 - (1 - water_score) * 0.3
        heat_score = max(0.0, 1 - heat / 20)
        score = 100 * (0.5 * reliability + 0.3 * water_score + 0.2 * heat_score) if sown else 0.0
        if not sown or reliability < 0.4:
            status = "Poor fit"
        elif score >= 75 and reliability >= 0.8:
            status = "Well suited"
        else:
            status = "Marginal"
        sow_offsets = [r["sow"] for r in sown]
        sow_med = quantile(sow_offsets, 0.5)
        sow_safe = quantile(sow_offsets, 0.8)
        limits = []
        if reliability < 0.8:
            limits.append(f"reached maturity in {round(reliability * len(runs))}/{len(runs)} seasons")
        if ratio < 0.7:
            limits.append(f"rain covers ~{round(ratio * 100)}% of crop water need")
        if heat >= 5:
            limits.append(f"~{round(heat)} heat-stress days (>{crop.heat_limit_c:.0f} °C)")
        out.append({
            **{k: v for k, v in asdict(crop).items() if k in ("name", "family", "note", "n_fixing", "perennial", "frost_tolerant")},
            "score": r1(score, 0),
            "status": status,
            "thermal_reliability": r1(reliability * 100, 0),
            "seasons": len(runs),
            "water_ratio": r1(ratio, 2),
            "rain_mm": r1(median([r["rain"] for r in sown]), 0) if sown else None,
            "water_need_mm": r1(median([r["need"] for r in sown]), 0) if sown else None,
            "heat_days": r1(heat, 1),
            "cycle_days": r1(median([r["cycle_days"] for r in sown]), 0) if sown else None,
            "sow_median": (start + timedelta(int(sow_med))).isoformat() if sow_med is not None else None,
            "sow_safe": (start + timedelta(int(sow_safe))).isoformat() if sow_safe is not None else None,
            "limits": limits,
            "params": {"base_c": crop.base_c, "gdd": crop.gdd, "sow_c": crop.sow_c, "kc": crop.kc,
                       "heat_limit_c": crop.heat_limit_c},
        })
    return sorted(out, key=lambda r: -r["score"])


# ---------------------------------------------------------------- rotations
def rank_rotations(profile: dict, priorities: list[float], plans: list[dict],
                   suitability: list[dict] | None) -> list[dict]:
    total = sum(priorities)
    weights = [p / total for p in priorities] if total else [1 / len(GOALS)] * len(GOALS)
    suit = {s["name"]: s for s in (suitability or [])}
    prev = CROPS.get(profile.get("previous_crop", ""), None)
    drainage, soil, irrigation = profile.get("drainage"), profile.get("soil"), profile.get("irrigation")
    ranked = []
    for plan in plans:
        crops = [CROPS[n] for n in plan["years"] if n in CROPS]
        if not crops:
            continue
        families = ([prev.family] if prev else []) + [c.family for c in crops]
        repeats = sum(1 for a, b in zip(families, families[1:]) if a == b)
        distinct = len({c.family for c in crops})
        legumes = sum(c.n_fixing for c in crops)
        has_ley = any(c.perennial for c in crops)
        potatoes = sum(c.family == "Solanaceae" for c in crops)
        reasons = []

        # Soil health
        soil_score = 50 + 25 * has_ley + (18 if legumes else 0) + 6 * max(0, legumes - 1) - 10 * potatoes - 8 * repeats
        if has_ley:
            reasons.append("Grass–clover ley adds root biomass and organic matter (+25 soil health).")
        if legumes:
            reasons.append(f"{legumes} nitrogen-fixing crop year(s) reduce fertiliser need.")

        # Short-return disease risk for brassicas and potatoes
        short_return = 0
        for fam in ("Brassica", "Solanaceae"):
            idx = [i for i, f in enumerate(families) if f == fam]
            short_return += sum(1 for a, b in zip(idx, idx[1:]) if b - a < 3)
        if short_return:
            reasons.append(f"{short_return} short return(s) of brassica/potato raise soil-borne disease risk.")

        # Water resilience: driven by NASA POWER rain vs crop water need when available
        water_parts = []
        for c in crops:
            s = suit.get(c.name)
            ratio = s["water_ratio"] if s and s["water_ratio"] is not None else max(0.4, 1.3 - 0.35 * c.kc / 0.8)
            w = min(1.0, ratio)
            if irrigation == "Yes":
                w = 1 - (1 - w) * 0.3
            if soil == "Sandy" and c.kc >= 0.9:
                w -= 0.08
            if drainage == "Poor" and c.waterlog_sensitive:
                w -= 0.15
            water_parts.append(max(0.0, w))
        water_score = 100 * mean(water_parts)
        dry = [c.name for c, w in zip(crops, water_parts) if w < 0.7]
        if dry:
            reasons.append(f"Historical rain covers <70% of water need for: {', '.join(sorted(set(dry)))}"
                           + ("" if irrigation == "Yes" else " (no irrigation recorded)") + ".")
        if drainage == "Poor" and any(c.waterlog_sensitive for c in crops):
            reasons.append("Poor drainage penalises waterlogging-sensitive crops (pea, potato, soybean).")

        # Diversity
        diversity = 100 * (distinct - 1) / max(1, len(crops) - 1) if len(crops) > 1 else 0
        diversity = max(0.0, diversity - 10 * short_return)
        reasons.append(f"{distinct} crop famil{'y' if distinct == 1 else 'ies'} over {len(crops)} years; "
                       f"{repeats} back-to-back famil{'y' if repeats == 1 else 'ies'} repeat(s) incl. previous crop.")

        # Yield stability: thermal reliability from NASA POWER history
        rel = [suit[c.name]["thermal_reliability"] / 100 for c in crops if c.name in suit]
        reliability = mean(rel) if rel else 0.75
        risky = [c.name for c in crops if c.name in suit and suit[c.name]["thermal_reliability"] < 80]
        if risky:
            reasons.append(f"Season too short/cool in some years for: {', '.join(sorted(set(risky)))}.")
        stability = 100 * reliability - 7 * repeats - 8 * short_return + 4 * (distinct - 1)
        if drainage == "Poor":
            stability -= 8 * sum(c.waterlog_sensitive for c in crops)

        if "Unknown" in (soil, drainage, irrigation):
            reasons.append("Some field inputs are unknown — record them to sharpen the ranking.")
        components = [max(0, min(100, round(v))) for v in (soil_score, water_score, diversity, stability)]
        score = sum(v * w for v, w in zip(components, weights))
        # Viability gate: a crop that rarely reaches maturity here sinks the whole rotation,
        # however good its soil or diversity benefits look on paper.
        viability = 1.0
        if rel:
            weakest = min(crops, key=lambda c: suit[c.name]["thermal_reliability"] if c.name in suit else 100)
            min_rel = suit[weakest.name]["thermal_reliability"] / 100 if weakest.name in suit else 1.0
            viability = min(1.0, 0.5 + min_rel)
            if viability < 1:
                reasons.insert(0, f"Score ×{viability:.2f}: {weakest.name} reached maturity in only "
                                  f"{min_rel:.0%} of past seasons here.")
        ranked.append({
            "name": plan.get("name", "Rotation"),
            "years": [c.name for c in crops],
            "components": components,
            "viability": round(viability, 2),
            "score": round(score * viability, 1),
            "reasons": reasons,
            "uses_climate": bool(suit),
        })
    return sorted(ranked, key=lambda r: -r["score"])
