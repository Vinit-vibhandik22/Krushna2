"""Forensics artifact serving router - pre-generated pipeline outputs by case_id."""

import os
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter(prefix="/api/forensics", tags=["forensics"])

BASE_DIR = Path(__file__).parent.parent
FORENSICS_CASES_DIR = BASE_DIR / "forensics_cases"


def _get_case_dir(case_id: str) -> Path:
    case_dir = FORENSICS_CASES_DIR / case_id
    if not case_dir.exists() or not case_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found")
    return case_dir


def _load_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("")
def list_forensics_cases() -> dict:
    """List all available forensic case IDs."""
    if not FORENSICS_CASES_DIR.exists():
        return {"cases": []}
    cases = [d.name for d in FORENSICS_CASES_DIR.iterdir() if d.is_dir()]
    return {"cases": sorted(cases)}


@router.get("/{case_id}")
def get_forensics_bundle(case_id: str) -> dict:
    """Get full forensic bundle for a case: origin, corridor, suspects, verdict, ranked list."""
    case_dir = _get_case_dir(case_id)

    origin_path = case_dir / "origin_report.json"
    corridor_path = case_dir / "trajectory_corridor.geojson"
    suspects_path = case_dir / "attribution" / "culprit_visual.geojson"
    dossier_path = case_dir / "attribution" / "culprit_dossier.json"

    if not origin_path.exists():
        raise HTTPException(status_code=404, detail=f"origin_report.json missing for '{case_id}'")
    if not corridor_path.exists():
        raise HTTPException(status_code=404, detail=f"trajectory_corridor.geojson missing for '{case_id}'")
    if not suspects_path.exists():
        raise HTTPException(status_code=404, detail=f"culprit_visual.geojson missing for '{case_id}'")
    if not dossier_path.exists():
        raise HTTPException(status_code=404, detail=f"culprit_dossier.json missing for '{case_id}'")

    origin = _load_json(origin_path)
    corridor = _load_json(corridor_path)
    suspects = _load_json(suspects_path)
    dossier = _load_json(dossier_path)

    verdict = dossier.get("forensic_verdict", {})
    ranked = dossier.get("ranked_vessel_candidates", [])

    report_html = f"/api/forensics/{case_id}/report.html"
    report_pdf = f"/api/forensics/{case_id}/report.pdf"

    return {
        "case_id": case_id,
        "origin": origin,
        "corridor": corridor,
        "suspects": suspects,
        "verdict": verdict,
        "ranked": ranked,
        "report_html_url": report_html,
        "report_pdf_url": report_pdf,
    }


@router.get("/{case_id}/report.html")
def get_forensics_html_report(case_id: str):
    """Serve HTML forensic investigation report."""
    case_dir = _get_case_dir(case_id)
    html_path = case_dir / "forensic_investigation_report.html"
    if not html_path.exists():
        raise HTTPException(status_code=404, detail=f"HTML report not found for '{case_id}'")
    return FileResponse(str(html_path), media_type="text/html")


@router.get("/{case_id}/report.pdf")
def get_forensics_pdf_report(case_id: str):
    """Serve PDF forensic investigation report."""
    case_dir = _get_case_dir(case_id)
    pdf_path = case_dir / "forensic_investigation_report.pdf"
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail=f"PDF report not found for '{case_id}'")
    return FileResponse(str(pdf_path), media_type="application/pdf")


@router.get("/{case_id}/corridor.geojson")
def get_corridor_geojson(case_id: str):
    """Serve trajectory corridor GeoJSON directly."""
    case_dir = _get_case_dir(case_id)
    path = case_dir / "trajectory_corridor.geojson"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"corridor not found for '{case_id}'")
    return FileResponse(str(path), media_type="application/geo+json")


@router.get("/{case_id}/culprits.geojson")
def get_culprits_geojson(case_id: str):
    """Serve culprit suspects GeoJSON directly."""
    case_dir = _get_case_dir(case_id)
    path = case_dir / "attribution" / "culprit_visual.geojson"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"culprits not found for '{case_id}'")
    return FileResponse(str(path), media_type="application/geo+json")
