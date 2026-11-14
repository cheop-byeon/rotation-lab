"""Rule-based farm advisories. Every advisory carries the evidence it used.

Each advisory has:
  * ``code`` + ``params``: a stable, language-neutral identifier and the raw
    values behind it, so the field view can phrase it in plain words in any
    language (see frontend/js/i18n/).
  * ``title``/``detail``/``action``/``evidence``: technical English text for the
    data view.
"""
from __future__ import annotations

from datetime import date


def _fmt_date(iso: str | None) -> str:
    return date.fromisoformat(iso).strftime("%d %b") if iso else "—"


def build_advisories(now: dict, frost: dict, gdd: dict, phase: str, suitability: list[dict],
                     seasons: list[dict], profile: dict) -> list[dict]:
    out: list[dict] = []

    def add(level, topic, code, params, title, detail, action, evidence):
        out.append({"level": level, "topic": topic, "code": code, "params": params,
                    "title": title, "detail": detail, "action": action,
                    "evidence": [{"label": k, "value": v} for k, v in evidence]})

    irrigated = profile.get("irrigation") == "Yes"
    drainage = profile.get("drainage")

    # --- Root-zone soil moisture (MERRA-2 GWETROOT via POWER)
    pct, root = now.get("root_wetness_pct"), now.get("root_wetness")
    soil_age = (date.fromisoformat(now["date"]) - date.fromisoformat(now["soil_date"])).days if now.get("soil_date") else 0
    asof = f" As of {_fmt_date(now['soil_date'])} ({soil_age} days ago, the latest comparable reanalysis)." if soil_age > 7 else ""
    if pct is not None:
        sp = {"pct": pct, "wetness": root, "normal": now["root_wetness_normal"], "as_of": now["soil_date"],
              "age_days": soil_age, "irrigated": irrigated, "poor_drainage": drainage == "Poor"}
        ev = [("Root-zone wetness", f"{root:.2f} (0 = dry, 1 = saturated)"),
              ("Typical for date", f"{now['root_wetness_normal']:.2f}"),
              ("Percentile vs. past years", f"{pct:.0f}th"),
              ("Observed", now["soil_date"] + (" (last MERRA-2 reanalysis day)" if now.get("nrt_break") else ""))]
        if pct <= 20:
            add("warning" if pct <= 10 else "watch", "water", "soil_dry", sp, "Root zone drier than usual",
                f"Soil moisture under the crop root zone is in the driest {pct:.0f}% for this time of year." + asof,
                "Prioritise irrigation on shallow-rooted or establishing crops; delay nitrogen top-dressing until rain."
                if irrigated else "Check soil at 20–30 cm before sowing or fertilising; favour drought-tolerant crops or later sowing.",
                ev)
        elif pct >= 85:
            add("watch" if drainage == "Poor" else "info", "water", "soil_wet", sp, "Root zone wetter than usual",
                f"Soil moisture is in the wettest {100 - pct:.0f}% for this time of year." + asof,
                "Avoid heavy machinery to limit compaction; check drains and wait for soil to dry before working it."
                + (" Poor drainage on this field raises waterlogging risk." if drainage == "Poor" else ""),
                ev)
        else:
            add("good", "water", "soil_normal", sp, "Soil moisture within the normal range",
                "Root-zone wetness is close to what is typical for this time of year." + asof, "No moisture action needed.", ev)

    # --- 30-day water balance (rain − Hargreaves ET0)
    bal = now.get("balance_30d")
    if bal is not None and phase in ("planting", "growing"):
        ev = [("Rain, last 30 days", f"{now['rain_30d']:.0f} mm (normal {now['rain_30d_normal']:.0f} mm)"),
              ("Reference ET₀, last 30 days", f"{now['et0_30d']:.0f} mm"), ("Balance", f"{bal:+.0f} mm")]
        if bal < -40:
            add("warning" if bal < -80 else "watch", "water", "water_deficit",
                {"deficit_mm": round(-bal), "rain_mm": now["rain_30d"], "et0_mm": now["et0_30d"], "irrigated": irrigated},
                "Crops are losing more water than rain supplies",
                f"Evaporative demand exceeded rainfall by {-bal:.0f} mm over the last month.",
                "Schedule irrigation for sensitive growth stages (flowering, grain fill)." if irrigated
                else "Expect moisture stress on light soils; prioritise weed control to save water.", ev)

    # --- Rainfall anomaly
    r30, rn = now.get("rain_30d"), now.get("rain_30d_normal")
    if r30 is not None and rn:
        ratio = r30 / rn
        rp = {"rain_mm": r30, "normal_mm": rn, "pct_of_normal": round(100 * ratio)}
        ev = [("Rain, last 30 days", f"{r30:.0f} mm"), ("Average for these dates", f"{rn:.0f} mm"),
              ("Rank vs. past years", f"{now['rain_30d_pct']:.0f}th percentile")]
        if ratio < 0.5:
            add("watch", "rain", "rain_dry", rp, "Dry month", f"Only {ratio:.0%} of normal rainfall fell in the last 30 days.",
                "Conserve soil moisture: shallow cultivation, keep residue on the surface.", ev)
        elif ratio > 1.7:
            add("watch", "rain", "rain_wet", rp, "Very wet month", f"Rainfall was {ratio:.0%} of normal in the last 30 days.",
                "Watch for fungal disease pressure and nitrogen leaching; scout fields after rain.", ev)

    # --- Frost & planting window
    if frost.get("frost_years"):
        ev = [("Median last spring frost", _fmt_date(frost["last_spring_median"])),
              ("1-in-5 risk date", _fmt_date(frost["last_spring_safe"])),
              ("Median first autumn frost", _fmt_date(frost["first_fall_median"])),
              ("Frost-free days (median)", f"{frost['frost_free_days_median']:.0f}"),
              ("Seasons analysed", str(frost["seasons"]))]
        best = [s for s in suitability if s["status"] == "Well suited"][:3]
        crops = ", ".join(f"{s['name']} (from {_fmt_date(s['sow_safe'])})" for s in best) or "none fully reliable"
        fp = {"last_frost": frost["last_spring_median"], "safe_after": frost["last_spring_safe"],
              "first_autumn_frost": frost["first_fall_median"], "early_autumn_frost": frost["first_fall_early"],
              "frost_free_days": frost["frost_free_days_median"], "short_season_days": frost["frost_free_days_short"],
              "best_crops": [{"name": s["name"], "sow_from": s["sow_safe"]} for s in best]}
        if phase == "planting":
            add("watch", "frost", "frost_planting", fp, "Planting window is open — frost risk remains",
                f"In 4 of 5 past seasons the last 2 m air frost had passed by {_fmt_date(frost['last_spring_safe'])}.",
                f"Sow frost-tolerant crops first; hold frost-sensitive crops until after that date. Reliable here: {crops}.", ev)
        elif phase == "harvest":
            add("watch", "frost", "frost_autumn", fp, "Autumn frost approaching",
                f"First autumn frost typically arrives around {_fmt_date(frost['first_fall_median'])}; "
                f"in 1 of 5 seasons by {_fmt_date(frost['first_fall_early'])}.",
                "Harvest frost-sensitive crops (potato, maize, soybean) before then.", ev)
        else:
            add("info", "frost", "frost_plan", fp, "Plan next season's sowing dates",
                f"The frost-free season here lasts about {frost['frost_free_days_median']:.0f} days "
                f"(short seasons: {frost['frost_free_days_short']:.0f}).",
                f"Plan around a last-frost date of {_fmt_date(frost['last_spring_safe'])}. Best-fit crops: {crops}.", ev)
    if now.get("frost_nights_7d") and phase in ("planting", "growing"):
        add("warning", "frost", "frost_recent", {"nights": now["frost_nights_7d"], "tmin": now["tmin"], "date": now["date"]},
            "Frost in the last week",
            f"{now['frost_nights_7d']} night(s) at or below 0 °C (2 m air) in the last 7 days.",
            "Inspect emerged frost-sensitive crops for damage.",
            [("Latest minimum", f"{now['tmin']:.1f} °C"), ("Date", now["date"])])

    # --- Thermal time (GDD) anomaly
    if gdd.get("to_date_normal") and gdd["to_date_normal"] > 50 and phase != "winter":
        diff = gdd["to_date"] - gdd["to_date_normal"]
        rel = diff / gdd["to_date_normal"]
        if abs(rel) >= 0.08:
            add("info", "heat", "season_ahead" if diff > 0 else "season_behind",
                {"pct": round(100 * abs(rel)), "gdd": gdd["to_date"], "normal": gdd["to_date_normal"]},
                f"Season running {'ahead' if diff > 0 else 'behind'}",
                f"Accumulated heat (GDD base {gdd['base']:.0f} °C) is {abs(rel):.0%} {'above' if diff > 0 else 'below'} the average for this date.",
                "Expect earlier crop development; scout pests and plan harvest earlier." if diff > 0
                else "Crops will develop later; consider earlier-maturing varieties if sowing is still ahead.",
                [("GDD this season", f"{gdd['to_date']}"), ("Average to date", f"{gdd['to_date_normal']}")])

    # --- Climate trend from recent seasons (heat & dry spells)
    if len(seasons) >= 6:
        recent, older = seasons[-3:], seasons[:-3]
        avg = lambda xs, k: sum(s[k] for s in xs) / len(xs)  # noqa: E731
        dh = avg(recent, "heat_days") - avg(older, "heat_days")
        if dh >= 3:
            add("watch", "trend", "heat_trend",
                {"extra_days": round(dh), "recent": round(avg(recent, "heat_days"), 1), "earlier": round(avg(older, "heat_days"), 1)},
                "Heat-stress days are increasing",
                f"The last 3 seasons averaged {dh:.0f} more days ≥30 °C than earlier seasons.",
                "Shift sensitive flowering away from mid-summer (earlier sowing, earlier varieties) or trial heat-tolerant crops.",
                [("Recent seasons", f"{avg(recent, 'heat_days'):.1f} days"), ("Earlier seasons", f"{avg(older, 'heat_days'):.1f} days")])
        dd = avg(recent, "longest_dry_spell") - avg(older, "longest_dry_spell")
        if dd >= 4:
            add("watch", "trend", "dry_trend",
                {"extra_days": round(dd), "recent": round(avg(recent, "longest_dry_spell")), "earlier": round(avg(older, "longest_dry_spell"))},
                "Longer dry spells in recent seasons",
                f"The longest dry spell grew by about {dd:.0f} days compared with earlier seasons.",
                "Consider deep-rooted crops (sunflower, ley) and residue retention to buffer dry spells.",
                [("Recent seasons", f"{avg(recent, 'longest_dry_spell'):.0f} days"), ("Earlier seasons", f"{avg(older, 'longest_dry_spell'):.0f} days")])

    # --- Data freshness
    if now.get("lag_days", 0) > 10:
        add("info", "data", "data_lag", {"date": now["date"], "lag_days": now["lag_days"]}, "Satellite/model data lag",
            f"The latest complete NASA POWER day is {now['date']} ({now['lag_days']} days ago).",
            "Pair with local weather observations for day-to-day decisions.", [("Latest data", now["date"])])

    order = {"warning": 0, "watch": 1, "info": 2, "good": 3}
    return sorted(out, key=lambda a: order[a["level"]])
