// Native fetch will be used

async function check() {
  try {
    const res = await fetch('http://localhost:8787/api/debug-comisiones');
    const data = await res.json();
    console.log("=== SNIPER DETECTOR RESULTS ===");
    console.log(JSON.stringify(data, null, 2));
  } catch(e) {
    console.error("Error connecting to worker. Make sure worker is running on localhost:8787", e.message);
  }
}

check();
