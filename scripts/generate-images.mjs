import OpenAI from "openai";
import { writeFile, readFile } from "fs/promises";

const SUPABASE_URL = "https://oyfyuszgjwcepjpngclv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95Znl1c3pnandjZXBqcG5nY2x2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQyOTQ0MywiZXhwIjoyMDkxMDA1NDQzfQ.YoMbefzmBd7gbhRQeVNCagSXte_87OQIeYkwCasD8wk";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "proxy",
  baseURL: process.env.OPENAI_BASE_URL,
});

const STYLE_ANCHOR = "Professional product photography on a clean pure white background, hardware store catalog style, high quality, sharp focus, centered composition, soft even lighting, no shadows, no text, realistic product render";

const products = [
  {
    id: "c9093090-2013-48dd-bcbe-468c251c98c4",
    codigo: "LAM 1954006",
    nombre: "LAMINA ARQUITECTONICA AZUL 6 mts",
    prompt: `${STYLE_ANCHOR}. A blue corrugated architectural metal roofing sheet, trapezoidal profile, bright blue color, 6 meters long rectangular metal panel shown at a slight angle to show the corrugation profile.`,
  },
  {
    id: "cf4954c3-f308-4109-861a-1e6b77f44dbf",
    codigo: "LAM 1954007",
    nombre: "LAMINA ARQUITECTONICA BLANCA 6 mts",
    prompt: `${STYLE_ANCHOR}. A white corrugated architectural metal roofing sheet, trapezoidal profile, bright white color, 6 meters long rectangular metal panel shown at a slight angle to show the corrugation profile.`,
  },
  {
    id: "a2e88776-f621-40f3-b820-630af5b6758a",
    codigo: "LAM 1954005",
    nombre: "LAMINA ARQUITECTONICA NARANJA 6 mts",
    prompt: `${STYLE_ANCHOR}. An orange corrugated architectural metal roofing sheet, trapezoidal profile, bright orange color, 6 meters long rectangular metal panel shown at a slight angle to show the corrugation profile.`,
  },
  {
    id: "c223491d-ff59-4c50-a779-b28e8f12df8d",
    codigo: "PER0112006",
    nombre: "PLETINA 1 X 1/4 X 6,00 mts",
    prompt: `${STYLE_ANCHOR}. A steel flat bar (pletina), 1 inch wide by 1/4 inch thick, 6 meters long. A single long flat rectangular steel bar, silver metallic color, industrial steel flat stock for construction.`,
  },
  {
    id: "b518bb2e-20dc-48ad-934b-7e8c392ea7ea",
    codigo: "TUB0903007",
    nombre: "TUBO ELEC. 2\" X 3,00 mts UNITECA",
    prompt: `${STYLE_ANCHOR}. A white PVC electrical conduit pipe, 2 inches diameter, 3 meters long. A single straight white plastic tube used for electrical wiring conduit, smooth surface.`,
  },
];

async function generateAndUpload(product) {
  console.log(`\nGenerating image for ${product.codigo}: ${product.nombre}...`);

  const resp = await client.chat.completions.create({
    model: "auto_image",
    messages: [{ role: "user", content: product.prompt }],
  });

  const images = resp.choices[0].message.images;
  if (!images?.[0]) {
    console.error(`  ✗ No image returned for ${product.codigo}`);
    return false;
  }

  const dataUrl = images[0].image_url.url;
  const base64Data = dataUrl.split(",")[1];
  const buffer = Buffer.from(base64Data, "base64");

  // Save locally first
  const localPath = `/tmp/${product.id}.png`;
  await writeFile(localPath, buffer);
  console.log(`  ✓ Generated (${(buffer.length / 1024).toFixed(0)} KB)`);

  // Convert to WebP using sharp-like approach - upload as PNG since we can't use sharp easily
  // The app compresses on upload, but for storage we'll upload the PNG and set the URL
  const storagePath = `${product.id}.webp`;

  // Upload to Supabase Storage
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/productos/${storagePath}`;
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
      "Cache-Control": "max-age=31536000",
    },
    body: buffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error(`  ✗ Upload failed: ${errText}`);
    return false;
  }
  console.log(`  ✓ Uploaded to storage`);

  // Update DB with image URL
  const timestamp = Date.now();
  const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/productos/${storagePath}?v=${timestamp}`;

  const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${product.id}`, {
    method: "PATCH",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
    },
    body: JSON.stringify({ imagen_url: imageUrl, actualizado_en: new Date().toISOString() }),
  });

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    console.error(`  ✗ DB update failed: ${errText}`);
    return false;
  }
  console.log(`  ✓ Database updated with image URL`);
  return true;
}

async function main() {
  console.log("=== GENERACIÓN DE IMÁGENES DE CATÁLOGO ===");
  let success = 0;

  for (const product of products) {
    try {
      const ok = await generateAndUpload(product);
      if (ok) success++;
    } catch (e) {
      console.error(`  ✗ Error for ${product.codigo}: ${e.message}`);
    }
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`Imágenes generadas: ${success}/${products.length}`);
}

main().catch(console.error);
