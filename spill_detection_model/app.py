import streamlit as st
import torch
import numpy as np
from PIL import Image
import segmentation_models_pytorch as smp
import cv2
import geojson
from datetime import datetime, timezone
import os
import gdown

st.set_page_config(page_title="Oil Spill Detection", layout="wide")

MODEL_PATH = "unet_model_real.pt"
GDRIVE_FILE_ID = "1iaHXni9vxgrgADup8fV0UkE54Y7R0Urr"  # <-- replace with your actual Drive file ID

@st.cache_resource
def load_model():
    if not os.path.exists(MODEL_PATH):
        with st.spinner("Downloading model weights (first load only)..."):
            gdown.download(f"https://drive.google.com/uc?id={GDRIVE_FILE_ID}", MODEL_PATH, quiet=False)

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    checkpoint = torch.load(MODEL_PATH, map_location=device)
    model = smp.Unet(
        encoder_name=checkpoint.get('encoder_name', 'resnet34'),
        encoder_weights=None,
        in_channels=checkpoint.get('in_channels', 1),
        classes=1,
    )
    model.load_state_dict(checkpoint['model_state_dict'])
    model.to(device)
    model.eval()
    return model, device

def preprocess(image: Image.Image, size=256):
    image = image.convert('L').resize((size, size))
    arr = np.array(image).astype(np.float32)
    arr = (arr - arr.mean()) / (arr.std() + 1e-8)
    tensor = torch.from_numpy(arr).unsqueeze(0).unsqueeze(0)
    return tensor, np.array(image)

def predict(model, device, tensor, threshold=0.5):
    with torch.no_grad():
        tensor = tensor.to(device)
        output = torch.sigmoid(model(tensor))
        mask = (output > threshold).float().cpu().numpy()[0, 0]
    return mask

def make_overlay(display_img, mask, alpha=0.4):
    img_rgb = np.stack([display_img]*3, axis=-1).astype(np.float32)
    red_overlay = np.zeros_like(img_rgb)
    red_overlay[..., 0] = 255  # red channel
    blended = img_rgb * (1 - alpha * mask[..., None]) + red_overlay * (alpha * mask[..., None])
    return blended.astype(np.uint8)

def mask_to_polygons(mask, min_area=20, epsilon_factor=0.002):
    mask_uint8 = (mask * 255).astype(np.uint8)
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons = []
    for cnt in contours:
        if cv2.contourArea(cnt) < min_area:
            continue
        epsilon = epsilon_factor * cv2.arcLength(cnt, True)
        simplified = cv2.approxPolyDP(cnt, epsilon, True)
        polygon = simplified.reshape(-1, 2).tolist()
        polygons.append(polygon)
    return polygons

def pixel_polygon_to_latlon_demo(polygon, img_size, bbox):
    min_lon, min_lat, max_lon, max_lat = bbox
    w, h = img_size
    latlon_polygon = []
    for x, y in polygon:
        lon = min_lon + (float(x) / w) * (max_lon - min_lon)
        lat = max_lat - (float(y) / h) * (max_lat - min_lat)
        latlon_polygon.append([float(lon), float(lat)])
    return latlon_polygon

def build_geojson(polygons, coverage_pct, img_size, bbox):
    features = []
    for i, polygon in enumerate(polygons):
        latlon = pixel_polygon_to_latlon_demo(polygon, img_size, bbox)
        latlon.append(latlon[0])
        feature = geojson.Feature(
            geometry=geojson.Polygon([latlon]),
            properties={
                "spill_id": f"spill_{i}",
                "detected_at": datetime.now(timezone.utc).isoformat(),
                "coverage_pct": round(float(coverage_pct), 2),
                "source": "unet_resnet34_sos"
            }
        )
        features.append(feature)
    return geojson.FeatureCollection(features)

st.title("🛢️ Oil Spill Detection — SAR Imagery")
st.markdown("Upload a Sentinel-1 SAR image chip to detect oil spill regions.")

model, device = load_model()

uploaded_file = st.file_uploader("Upload SAR image", type=['png', 'jpg', 'jpeg'])
threshold = st.slider("Detection threshold", 0.0, 1.0, 0.5, 0.05)

st.subheader("Demo bounding box (placeholder coordinates)")
col_a, col_b = st.columns(2)
with col_a:
    min_lon = st.number_input("Min Longitude", value=-90.5, format="%.4f")
    min_lat = st.number_input("Min Latitude", value=27.5, format="%.4f")
with col_b:
    max_lon = st.number_input("Max Longitude", value=-90.0, format="%.4f")
    max_lat = st.number_input("Max Latitude", value=28.0, format="%.4f")

if uploaded_file is not None:
    image = Image.open(uploaded_file)
    tensor, display_img = preprocess(image)
    mask = predict(model, device, tensor, threshold)

    spill_pixels = mask.sum()
    total_pixels = mask.size
    spill_pct = 100 * spill_pixels / total_pixels

    col1, col2, col3 = st.columns(3)
    with col1:
        st.subheader("Input SAR")
        st.image(display_img, use_container_width=True, clamp=True)
    with col2:
        st.subheader("Predicted Spill Mask")
        st.image(mask, use_container_width=True, clamp=True)
    with col3:
    st.subheader("Overlay")
    overlay_img = make_overlay(display_img, mask)
    st.image(overlay_img, use_container_width=True, clamp=True)

    st.metric("Spill coverage", f"{spill_pct:.2f}%")
    if spill_pct > 0.1:
        st.warning(f"⚠️ Potential oil spill detected — {spill_pct:.2f}% of scene")
    else:
        st.success("✅ No significant spill detected")

    polygons = mask_to_polygons(mask)
    if polygons:
        bbox = (min_lon, min_lat, max_lon, max_lat)
        fc = build_geojson(polygons, spill_pct, img_size=mask.shape[::-1], bbox=bbox)
        geojson_str = geojson.dumps(fc, indent=2)

        st.subheader("GeoJSON Output")
        st.json(fc)
        st.download_button(
            "⬇️ Download GeoJSON",
            geojson_str,
            file_name="spill_detection.geojson",
            mime="application/json"
        )
    else:
        st.info("No spill polygons above minimum area threshold — nothing to export.")
else:
    st.info("Upload a SAR image chip to run detection.")
