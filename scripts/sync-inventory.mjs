// Sync inventory from PDF price list (20/04/2026) to Supabase
const SUPABASE_URL = "https://oyfyuszgjwcepjpngclv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95Znl1c3pnandjZXBqcG5nY2x2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTQyOTQ0MywiZXhwIjoyMDkxMDA1NDQzfQ.YoMbefzmBd7gbhRQeVNCagSXte_87OQIeYkwCasD8wk";

// All products from the PDF price list
const pdfProducts = [
  // === 1. CEMENTO ===
  { codigo: "CEM1045001", nombre: "CEMENTO GRIS ENSACADO", categoria: "CEMENTO", unidad: "Saco", precio_usd: null, costo_usd: 11.00, stock_actual: 720 },
  // === 2. ALAMBRE ===
  { codigo: "ALA0403001", nombre: "ALAMBRE GALVANIZADO CALIBRE 18", categoria: "ALAMBRE", unidad: "Rollo", precio_usd: 1.98, costo_usd: null, stock_actual: 4798 },
  // === 3. ALAMBRON ===
  { codigo: "ALB0141005", nombre: "ALAMBRON 5,2 mm X 6 mts", categoria: "ALAMBRON", unidad: "Und", precio_usd: 1.49, costo_usd: 1.29, stock_actual: 76851 },
  { codigo: "ALB0141006", nombre: "ALAMBRON 6,0 mm X 6 mts", categoria: "ALAMBRON", unidad: "Und", precio_usd: 1.90, costo_usd: null, stock_actual: 41 },
  { codigo: "ALB0141001", nombre: "ALAMBRON 7,0 mm X 6 mts", categoria: "ALAMBRON", unidad: "Und", precio_usd: 2.90, costo_usd: null, stock_actual: 3 },
  // === 4. BARRAS ===
  { codigo: "BAR0101001", nombre: "BARRA CUADRADA LISA 12mm X 6,00 mts", categoria: "BARRAS", unidad: "Und", precio_usd: 8.58, costo_usd: 7.50, stock_actual: 2600 },
  { codigo: "BAR0103001", nombre: "BARRA REDONDA LISA 10mm X 6,00 mts", categoria: "BARRAS", unidad: "Und", precio_usd: 4.40, costo_usd: 3.16, stock_actual: 9895 },
  { codigo: "BAR0103002", nombre: "BARRA REDONDA LISA 12mm X 6,00 mts", categoria: "BARRAS", unidad: "Und", precio_usd: 7.34, costo_usd: 6.66, stock_actual: 2793 },
  // === 5. CABILLAS ===
  { codigo: "CAB0114004", nombre: "CABILLA ESTRIADA  3/8 X 12,00 mts SIDETUR", categoria: "CABILLAS", unidad: "Und", precio_usd: 8.70, costo_usd: null, stock_actual: 38 },
  { codigo: "CAB0114007", nombre: "CABILLA ESTRIADA 1/2 X 6,00 mts  SIDETUR", categoria: "CABILLAS", unidad: "Und", precio_usd: 6.00, costo_usd: null, stock_actual: 1442 },
  { codigo: "CAB0114003", nombre: "CABILLA ESTRIADA 1/2 X 9,00 mts  IMPORTADA", categoria: "CABILLAS", unidad: "Und", precio_usd: 7.00, costo_usd: null, stock_actual: 3 },
  { codigo: "CAB0114009", nombre: "CABILLA ESTRIADA 5/8 X 12,00 mts SIDETUR", categoria: "CABILLAS", unidad: "Und", precio_usd: 22.00, costo_usd: null, stock_actual: 1456 },
  { codigo: "CAB0114012", nombre: "CABILLA ESTRIADA 3/4 X 12,00 mts SIDOR", categoria: "CABILLAS", unidad: "Und", precio_usd: 26.00, costo_usd: null, stock_actual: 15 },
  { codigo: "CAB0114013", nombre: "CABILLA ESTRIADA 3/4 X 6,00 mts SIDOR", categoria: "CABILLAS", unidad: "Und", precio_usd: 17.75, costo_usd: null, stock_actual: 6 },
  { codigo: "CAB0114014", nombre: "CABILLA ESTRIADA 7/8 X 12,00 mts  SIZUCA", categoria: "CABILLAS", unidad: "Und", precio_usd: 34.00, costo_usd: null, stock_actual: 5 },
  { codigo: "CAB0114001", nombre: "CABILLA ESTRIADA 1\" X 12,00 mts LEVE OXIDO", categoria: "CABILLAS", unidad: "Und", precio_usd: 42.00, costo_usd: 38.00, stock_actual: 1 },
  { codigo: "CAB0114015", nombre: "CABILLA ESTRIADA 1\" X 12,00 mts SIDETUR", categoria: "CABILLAS", unidad: "Und", precio_usd: 45.00, costo_usd: 44.00, stock_actual: 25 },
  // === 6. CERCHAS ===
  { codigo: "CER0100001", nombre: "CERCHAS 10mm X 6 mts", categoria: "CERCHAS", unidad: "Und", precio_usd: 8.50, costo_usd: 7.90, stock_actual: 2230 },
  { codigo: "CER0100002", nombre: "CERCHAS 15mm X 6 mts", categoria: "CERCHAS", unidad: "Und", precio_usd: 8.90, costo_usd: 8.50, stock_actual: 916 },
  // === 7. FLANCHE ===
  { codigo: "FLA0101001", nombre: "FLANCHE 20 X 20 X 12 mm", categoria: "FLANCHE", unidad: "Und", precio_usd: 7.50, costo_usd: null, stock_actual: 387 },
  // === 8. LAMINAS HIERRO NEGRO ===
  { codigo: "LAM0113007", nombre: "LAMINA HN 2,50 mm X 1,250 X 2,40 m", categoria: "LAMINAS HIERRO NEGRO", unidad: "Lam", precio_usd: 72.00, costo_usd: 69.00, stock_actual: 44 },
  { codigo: "LAM0113001", nombre: "LAMINA HN 3,00 mm X 1,250 X 2,40 m", categoria: "LAMINAS HIERRO NEGRO", unidad: "Lam", precio_usd: 87.00, costo_usd: null, stock_actual: 54 },
  { codigo: "LAM0113008", nombre: "LAMINA HN 5,00 mm X 1,005 X 2,40 m", categoria: "LAMINAS HIERRO NEGRO", unidad: "Lam", precio_usd: 138.71, costo_usd: null, stock_actual: 4 },
  { codigo: "LAM0113002", nombre: "LAMINA HN 5,00 mm X 1,200 X 2,40 m", categoria: "LAMINAS HIERRO NEGRO", unidad: "Lam", precio_usd: 147.80, costo_usd: null, stock_actual: 8 },
  { codigo: "LAM0113003", nombre: "LAMINA HN 5,00 mm X 1,205 X 2,40 m", categoria: "LAMINAS HIERRO NEGRO", unidad: "Lam", precio_usd: 145.00, costo_usd: null, stock_actual: 5 },
  { codigo: "LAM0113004", nombre: "LAMINA HN 6,00 mm X 1,005 X 2,00 m", categoria: "LAMINAS HIERRO NEGRO", unidad: "Lam", precio_usd: 129.00, costo_usd: null, stock_actual: 3 },
  { codigo: "LAM0113005", nombre: "LAMINA HN 6,00 mm X 1,205 X 2,40 m", categoria: "LAMINAS HIERRO NEGRO", unidad: "Lam", precio_usd: 167.00, costo_usd: null, stock_actual: 1 },
  { codigo: "LAM0113009", nombre: "LAMINA HN 10,00 mm X 1,200 X 2,40 m", categoria: "LAMINAS HIERRO NEGRO", unidad: "Lam", precio_usd: 331.78, costo_usd: null, stock_actual: 1 },
  // === 9. LAMINAS HIERRO PULIDO ===
  { codigo: "LAM0213001", nombre: "LAMINA HP 0,45 mm X 1,20 X 2,40 m", categoria: "LAMINAS HIERRO PULIDO", unidad: "Lam", precio_usd: 16.00, costo_usd: 14.50, stock_actual: 278 },
  { codigo: "LAM0213002", nombre: "LAMINA HP 0,70 mm X 1,20 m X 1,40 m PROMOCION", categoria: "LAMINAS HIERRO PULIDO", unidad: "Lam", precio_usd: 9.95, costo_usd: 8.00, stock_actual: 1452 },
  { codigo: "LAM0213003", nombre: "LAMINA HP 0,90 mm X 1,20  X 2,40 m", categoria: "LAMINAS HIERRO PULIDO", unidad: "Lam", precio_usd: 32.55, costo_usd: 25.00, stock_actual: 27 },
  { codigo: "LAM0213004", nombre: "LAMINA HP 0,90 mm X 1,23 X 2,00 m", categoria: "LAMINAS HIERRO PULIDO", unidad: "Lam", precio_usd: 24.80, costo_usd: 23.00, stock_actual: 77 },
  { codigo: "LAM0213006", nombre: "LAMINA HP 1,50 mm X 1,20 X 1,40 m", categoria: "LAMINAS HIERRO PULIDO", unidad: "Lam", precio_usd: 21.95, costo_usd: 18.00, stock_actual: 154 },
  // === 10. LAMINAS ESTRIADA ===
  { codigo: "LAM0114001", nombre: "LAMINA EST. 2,50 mm X 1010 X 2,40 m", categoria: "LAMINAS ESTRIADA", unidad: "Lam", precio_usd: 63.00, costo_usd: 59.00, stock_actual: 10 },
  { codigo: "LAM0114002", nombre: "LAMINA EST. 5,00 mm X 1010 X 2,20 m", categoria: "LAMINAS ESTRIADA", unidad: "Lam", precio_usd: 129.00, costo_usd: null, stock_actual: 5 },
  // === 11. LAMINAS GALVANIZADA ===
  { codigo: "LAM0413001", nombre: "LAMINA GALV. LISA CAL. 26-0,40 mm X 1200 X 2,40 m", categoria: "LAMINAS GALVANIZADA", unidad: "Lam", precio_usd: 14.95, costo_usd: null, stock_actual: 148 },
  { codigo: "LAM0413010", nombre: "LAMINA GALV. LISA CAL.  17-1,10 mm X 1200 X 2,40 m", categoria: "LAMINAS GALVANIZADA", unidad: "Lam", precio_usd: 34.85, costo_usd: 32.00, stock_actual: 1 },
  { codigo: "LAM0413009", nombre: "LAMINA GALV. LISA CAL.  17-1,50 mm X 1200 X 2,40 m", categoria: "LAMINAS GALVANIZADA", unidad: "Lam", precio_usd: 47.00, costo_usd: 45.00, stock_actual: 12 },
  { codigo: "LAM0413011", nombre: "LAMINA GALV. LISA CAL.  17-1,90 mm X 1200 X 2,40 m", categoria: "LAMINAS GALVANIZADA", unidad: "Lam", precio_usd: 58.65, costo_usd: 56.00, stock_actual: 4 },
  // === 12. LAMINAS DE TECHO ===
  { codigo: "LAM1255001", nombre: "LAMINA TERMOPANEL SOLAR 3,70 X 1,04 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 90.00, costo_usd: null, stock_actual: 7 },
  { codigo: "LAM1255002", nombre: "LAMINA TERMOPANEL SOLAR 4,05 X 1,04 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 90.00, costo_usd: null, stock_actual: 1 },
  { codigo: "LAM1255003", nombre: "LAMINA TERMOPANEL SOLAR  4,20 X 1,04 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 198.00, costo_usd: null, stock_actual: 29 },
  { codigo: "LAM1255004", nombre: "LAMINA TERMOPANEL SOLAR 4,90 X 1,02 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 100.00, costo_usd: null, stock_actual: 1 },
  { codigo: "LAM1255005", nombre: "LAMINA TERMOPANEL SOLAR 5,90 X 1,04 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 150.00, costo_usd: null, stock_actual: 1 },
  { codigo: "LAM1255006", nombre: "LAMINA TERMOPANEL SOLAR 7,90 X 1,04 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 150.00, costo_usd: null, stock_actual: 7 },
  { codigo: "LAM1915006", nombre: "LOSACERO 6,10 X 0,80 mts CAL 20", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 59.50, costo_usd: null, stock_actual: 168 },
  { codigo: "LAM1915001", nombre: "LOSACERO 6,10 X 0,79 mts CAL 22", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 49.50, costo_usd: null, stock_actual: 0 },
  { codigo: "LAM1915003", nombre: "LOSACERO 6,10 X 0,60 mts CAL 24", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 43.20, costo_usd: null, stock_actual: 52 },
  { codigo: "LAM1915004", nombre: "LOSACERO 6,10 X 0,65 mts CAL 24", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 44.95, costo_usd: null, stock_actual: 37 },
  { codigo: "LAM1915002", nombre: "LOSACERO 6,10 X 0,80 mts CAL 24", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 46.95, costo_usd: null, stock_actual: 94 },
  { codigo: "LAM1915005", nombre: "LOSACERO 6,10 X 0,75 mts CAL 26", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 40.80, costo_usd: null, stock_actual: 6 },
  { codigo: "LAM0413003", nombre: "LAMINA ZINC GALV.  0,17 X 0.80 X 3,66 m", categoria: "LAMINAS DE TECHO", unidad: "Und", precio_usd: 6.50, costo_usd: null, stock_actual: 888 },
  { codigo: "LAM1916001", nombre: "LAM. PREPINTADO ROJO (ZINC) 0,15 X 800 X 3,00 MTS", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 7.16, costo_usd: null, stock_actual: 26 },
  { codigo: "LAM1916002", nombre: "LAM. PREPINTADO ROJO (ZINC) 0,15 X 800 X 3,60 MTS", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 8.62, costo_usd: null, stock_actual: 78 },
  { codigo: "LAM1916005", nombre: "LAMINA PR1 PREPINTADO ROJO 0,27 X 1050 X 3,00 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 16.53, costo_usd: null, stock_actual: 31 },
  { codigo: "LAM1916006", nombre: "LAMINA PR1 PREPINTADO ROJO 0,27 X 1050 X 3,60 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 19.92, costo_usd: null, stock_actual: 15 },
  { codigo: "LAM1954001", nombre: "LAMINA GALVATECHO  5,80 X 0,90 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 55.00, costo_usd: null, stock_actual: 2 },
  { codigo: "LAM1954003", nombre: "LAMINA ARQUITECTONICA AZUL 6 mts x 1,08 x 0,25 cal", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 27.50, costo_usd: 25.00, stock_actual: 127 },
  { codigo: "LAM1954004", nombre: "LAMINA ARQUITECTONICA ROJA 6 mts x 1,08 x 0,25 cal", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 27.50, costo_usd: 25.00, stock_actual: 16 },
  { codigo: "LAM 1954006", nombre: "LAMINA ARQUITECTONICA AZUL 6 mts x 1,08 x 0,35 cal", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 35.00, costo_usd: 33.65, stock_actual: 27 },
  { codigo: "LAM 1954007", nombre: "LAMINA ARQUITECTONICA BLANCA 6 mts x 1,08 x 0,35 cal", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 35.00, costo_usd: 33.65, stock_actual: 10 },
  { codigo: "LAM 1954005", nombre: "LAMINA ARQUITECTONICA NARANJA 6 mts x 1,08 x 0,35 cal", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 35.00, costo_usd: 33.65, stock_actual: 87 },
  { codigo: "LAM1955007", nombre: "LAMINA TIPO PVC MIL TEJAS TRANSPARENTE  6,60 X 1,04 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 48.00, costo_usd: null, stock_actual: 4 },
  { codigo: "LAM1955005", nombre: "CABALLETE CUMBRERA 0,70 X 2,00 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 17.00, costo_usd: 12.00, stock_actual: 480 },
  { codigo: "LAM1954002", nombre: "REMATE PARA FACHADA 0,20 X 2,00 mts", categoria: "LAMINAS DE TECHO", unidad: "Lam", precio_usd: 5.00, costo_usd: 3.00, stock_actual: 600 },
  // === 13. LAMINAS OTRAS ===
  { codigo: "LAM1115001", nombre: "LAMINA MIL TEJAS 2,00 X 1,05 M X 5,70 M", categoria: "LAMINAS OTRAS", unidad: "Lam", precio_usd: 57.60, costo_usd: null, stock_actual: 200 },
  // === 14. MALLAS ===
  { codigo: "MAL0138001", nombre: "MALLA TRUCKSON 5 X 5 X 120 mts", categoria: "MALLAS", unidad: "Und", precio_usd: 295.00, costo_usd: null, stock_actual: 9 },
  { codigo: "MAL0138002", nombre: "MALLA TRUCKSON 6 X 6 X 100 mts", categoria: "MALLAS", unidad: "Und", precio_usd: 139.00, costo_usd: null, stock_actual: 48 },
  // === 15. VIGAS WE ===
  { codigo: "VIG0110001", nombre: "VIGA WF 10X17 TIPO IPE 260 X 100 X 5,92 mts C/FLANCHE12X22cmX16mm", categoria: "VIGAS WE", unidad: "Und", precio_usd: 190.00, costo_usd: null, stock_actual: 1 },
  { codigo: "VIG0110002", nombre: "VIGA WF 12X19 TIPO IPE 300 X 100 X 6,00 mts", categoria: "VIGAS WE", unidad: "Und", precio_usd: 270.00, costo_usd: null, stock_actual: 147 },
  { codigo: "VIG0110003", nombre: "VIGA WF 12X22 TIPO IPE 300 X 105 X 6,00 mts", categoria: "VIGAS WE", unidad: "Und", precio_usd: 280.00, costo_usd: null, stock_actual: 32 },
  { codigo: "VIG0110004", nombre: "VIGA WF 12X26 TIPO IPE 300 X 165 X 6,18 mts C/FLANCHE45X17cmX16mm", categoria: "VIGAS WE", unidad: "Und", precio_usd: 290.00, costo_usd: null, stock_actual: 34 },
  // === 16. ZUNCHO ===
  { codigo: "ZUN0140004", nombre: "ZUNCHO 12 X 15 X 5,20 mm (Paquete 20 und)", categoria: "ZUNCHO", unidad: "Paq", precio_usd: 7.50, costo_usd: null, stock_actual: 23 },
  { codigo: "ZUN0140005", nombre: "ZUNCHO 15 X 15 X 5,20 mm (Paquete 20 und)", categoria: "ZUNCHO", unidad: "Paq", precio_usd: 7.90, costo_usd: null, stock_actual: 22 },
  { codigo: "ZUN0140010", nombre: "ZUNCHO 15 X 20 X 5,20 mm (Paquete 20 und)", categoria: "ZUNCHO", unidad: "Paq", precio_usd: null, costo_usd: null, stock_actual: 34 },
  // === 17. PERFILES ANGULOS ===
  { codigo: "PER0111001", nombre: "ANGULO 20 X 3mm X 6,00 mts", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 9.00, costo_usd: 8.00, stock_actual: 165 },
  { codigo: "PER0111008", nombre: "ANGULO 25 X 3mm X 6,00 mts", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 9.67, costo_usd: null, stock_actual: 53 },
  { codigo: "PER0111012", nombre: "ANGULO 30 X 2,5mm X 6,00 mts", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 9.98, costo_usd: null, stock_actual: 270 },
  { codigo: "PER0111009", nombre: "ANGULO 40 X 3mm X 6,00 mts *", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 15.96, costo_usd: null, stock_actual: 85 },
  { codigo: "PER0111002", nombre: "ANGULO 40 X 4mm X 6,00 mts *", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 21.00, costo_usd: null, stock_actual: 106 },
  { codigo: "PER0111003", nombre: "ANGULO 50 X 4mm X 6,00 mts *", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 30.38, costo_usd: null, stock_actual: 4 },
  { codigo: "PER0111011", nombre: "ANGULO 75 X 7mm X 12,00 mts", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 106.22, costo_usd: null, stock_actual: 115 },
  { codigo: "PER0111010", nombre: "ANGULO 75 X 8mm X 6,00 mts", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 72.88, costo_usd: null, stock_actual: 1 },
  { codigo: "PER0111006", nombre: "ANGULO 75 X 8mm X 12,00 mts", categoria: "PERFILES ANGULOS", unidad: "Und", precio_usd: 129.00, costo_usd: null, stock_actual: 23 },
  // === 18. PLETINAS ===
  { codigo: "PER0112003", nombre: "PLETINA 1 X 1/8 X 6,00 mts", categoria: "PLETINAS", unidad: "Und", precio_usd: 7.01, costo_usd: null, stock_actual: 152 },
  { codigo: "PER0112006", nombre: "PLETINA 1 X 1/4 X 6,00 mts", categoria: "PLETINAS", unidad: "Und", precio_usd: 9.90, costo_usd: null, stock_actual: 278 },
  { codigo: "PER0112002", nombre: "PLETINA 1 1/2  X 3/16 x 6,00 mts", categoria: "PLETINAS", unidad: "Und", precio_usd: 14.19, costo_usd: null, stock_actual: 13 },
  { codigo: "PER0112005", nombre: "PLETINA 2 X 1/8 X 6,00 mts", categoria: "PLETINAS", unidad: "Und", precio_usd: 14.01, costo_usd: null, stock_actual: 100 },
  // === 19. PORTONES / PERFILES ===
  { codigo: "PER0101001", nombre: "PORTONES DECORATIVOS 2,58 X 2,52 mts", categoria: "PERFILES", unidad: "Und", precio_usd: 275.00, costo_usd: null, stock_actual: 21 },
  { codigo: "PER0143001", nombre: "PERFIL PARA MARCOS DE PUERTAS 10 X 5,80  mts", categoria: "PERFILES", unidad: "Und", precio_usd: 12.00, costo_usd: null, stock_actual: 607 },
  // === 20. TUBOS ESTRUCTURALES CUADRADO ===
  { codigo: "TUB0301009", nombre: "TUBO ESTRUC. CUAD. 40 X 40 X 2,50mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 25.62, costo_usd: null, stock_actual: 93 },
  { codigo: "TUB0301010", nombre: "TUBO ESTRUC. CUAD. 50 X 50 X 2,50mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 31.00, costo_usd: null, stock_actual: 23 },
  { codigo: "TUB0301011", nombre: "TUBO ESTRUC. CUAD. 60 X 60 X 2,5mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 43.50, costo_usd: null, stock_actual: 31 },
  { codigo: "TUB0301012", nombre: "TUBO ESTRUC. CUAD. 70 X 70 X 2,5mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 48.58, costo_usd: null, stock_actual: 3 },
  { codigo: "TUB0301013", nombre: "TUBO ESTRUC. CUAD. 90 X 90 X 2,00mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 39.00, costo_usd: null, stock_actual: 20 },
  { codigo: "TUB0301014", nombre: "TUBO ESTRUC. CUAD. 90 X 90 X 3,2mm X 3,90 mts 2da", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 35.00, costo_usd: null, stock_actual: 13 },
  { codigo: "TUB0301015", nombre: "TUBO ESTRUC. CUAD. 90 X 90 X 3,2mm X 4,85 mts 2da", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 43.00, costo_usd: null, stock_actual: 57 },
  { codigo: "TUB0301020", nombre: "TUBO ESTRUC. CUAD. 100 X 100 X 1,50mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 36.00, costo_usd: null, stock_actual: 75 },
  { codigo: "TUB0301021", nombre: "TUBO ESTRUC. CUAD. 100 X 100 X 3,5mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 139.00, costo_usd: null, stock_actual: 35 },
  { codigo: "TUB0301018", nombre: "TUBO ESTRUC. CUAD. 120 X 120 X 4,00 mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 295.20, costo_usd: null, stock_actual: 6 },
  { codigo: "TUB0301022", nombre: "TUBO ESTRUC. CUAD. 120 X 120 X 4,50 mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 249.00, costo_usd: null, stock_actual: 20 },
  { codigo: "TUB0301005", nombre: "TUBO ESTRUC. CUAD. 125 X 125 X 4,00mm X 2,06 mts   2da", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 26.78, costo_usd: null, stock_actual: 131 },
  { codigo: "TUB0301006", nombre: "TUBO ESTRUC. CUAD. 125 X 125 X 4,00mm X 2,20 mts   2da", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 28.60, costo_usd: null, stock_actual: 107 },
  { codigo: "TUB0301007", nombre: "TUBO ESTRUC. CUAD. 125 X 125 X 4,00mm X 2,60 mts   2da", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 33.80, costo_usd: null, stock_actual: 4 },
  { codigo: "TUB0301023", nombre: "TUBO ESTRUC. CUAD. 155 X 155 X 4,20mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 402.41, costo_usd: null, stock_actual: 9 },
  { codigo: "TUB0301008", nombre: "TUBO ESTRUC. CUAD. 200 X 200 X 5,00mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES CUADRADO", unidad: "Pza", precio_usd: 470.00, costo_usd: null, stock_actual: 3 },
  // === 21. TUBOS ESTRUCTURALES RECTANGULAR ===
  { codigo: "TUB0302005", nombre: "TUBO ESTRUC. RECT. 80 X 40 X 2,00mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 32.00, costo_usd: 29.00, stock_actual: 247 },
  { codigo: "TUB0302010", nombre: "TUBO ESTRUC. RECT. 80 X 40 X 2,50mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 78.00, costo_usd: null, stock_actual: 42 },
  { codigo: "TUB0302001", nombre: "TUBO ESTRUC. RECT. 100 X 40 X 2,00mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 44.00, costo_usd: null, stock_actual: 86 },
  { codigo: "TUB0302007", nombre: "TUBO ESTRUC. RECT. 100 X 40 X 2,50mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 92.37, costo_usd: null, stock_actual: 96 },
  { codigo: "TUB0302002", nombre: "TUBO ESTRUC. RECT. 120 X 60 X 2,5mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 56.00, costo_usd: 45.00, stock_actual: 90 },
  { codigo: "TUB0302008", nombre: "TUBO ESTRUC. RECT. 120 X 60 X 2,5mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 117.70, costo_usd: null, stock_actual: 9 },
  { codigo: "TUB0339001", nombre: "TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 2,60 mts 2da", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 19.00, costo_usd: null, stock_actual: 1164 },
  { codigo: "TUB0339002", nombre: "TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 3,00 mts 2da", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 23.00, costo_usd: null, stock_actual: 177 },
  { codigo: "TUB0339003", nombre: "TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 4,60 mts  2da", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 36.00, costo_usd: null, stock_actual: 144 },
  { codigo: "TUB0339004", nombre: "TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 4,80 mts  2da", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 39.00, costo_usd: null, stock_actual: 31 },
  { codigo: "TUB0339005", nombre: "TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 6,00 mts  2da Sold", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 48.00, costo_usd: 44.00, stock_actual: 110 },
  { codigo: "TUB0302006", nombre: "TUBO ESTRUC. RECT. 140 X 60 X 2,50mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 68.58, costo_usd: null, stock_actual: 18 },
  { codigo: "TUB0302003", nombre: "TUBO ESTRUC. RECT. 160 X 65 X 3,00mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 210.00, costo_usd: null, stock_actual: 18 },
  { codigo: "TUB0302009", nombre: "TUBO ESTRUC. RECT. 200 X 70 X 3,00mm X 12,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 244.95, costo_usd: null, stock_actual: 24 },
  { codigo: "TUB0302004", nombre: "TUBO ESTRUC. RECT. 220 X 90 X 5,00mm X 6,00 mts", categoria: "TUBOS ESTRUCTURALES RECTANGULAR", unidad: "Pza", precio_usd: 170.00, costo_usd: null, stock_actual: 2 },
  // === 22. TUBOS PULIDO CUADRADO ===
  { codigo: "TUB0201003", nombre: "TUBO PULIDO CUAD. 1/2 X 1/2 X 0,90 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 3.01, costo_usd: null, stock_actual: 138 },
  { codigo: "TUB0201009", nombre: "TUBO PULIDO CUAD. 3/4 X 3/4 X 0,80 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 4.62, costo_usd: null, stock_actual: 3 },
  { codigo: "TUB0201015", nombre: "TUBO PULIDO CUAD. 3/4 X 3/4 X 0,90 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: null, costo_usd: null, stock_actual: 200 },
  { codigo: "TUB0201005", nombre: "TUBO PULIDO CUAD. 1 X 1 X 0,90mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 6.84, costo_usd: null, stock_actual: 79 },
  { codigo: "TUB0201014", nombre: "TUBO PULIDO CUAD. 1 X 1 X 1,90mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 12.07, costo_usd: null, stock_actual: 32 },
  { codigo: "TUB0201001", nombre: "TUBO PULIDO CUAD. 1 1/2 X 1 1/2 X 0,80 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 9.60, costo_usd: null, stock_actual: 50 },
  { codigo: "TUB0201002", nombre: "TUBO PULIDO CUAD. 1 1/2 X 1 1/2 X 0,90 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 9.78, costo_usd: null, stock_actual: 170 },
  { codigo: "TUB0201013", nombre: "TUBO PULIDO CUAD. 1 1/2 X 1 1/2 X 1,50 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 15.11, costo_usd: null, stock_actual: 62 },
  { codigo: "TUB0201012", nombre: "TUBO PULIDO CUAD. 1 1/4 X 1 1/4 X 0,90 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 7.52, costo_usd: null, stock_actual: 70 },
  { codigo: "TUB0201011", nombre: "TUBO PULIDO CUAD. 2 X 2 X 0,90 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 13.30, costo_usd: null, stock_actual: 98 },
  { codigo: "TUB0201006", nombre: "TUBO PULIDO CUAD. 2 X 2 X 1,00 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 14.00, costo_usd: null, stock_actual: 20 },
  { codigo: "TUB0201017", nombre: "TUBO PULIDO CUAD. 2 X 2 X 1,50 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 19.35, costo_usd: null, stock_actual: 98 },
  { codigo: "TUB0201008", nombre: "TUBO PULIDO CUAD. 2 X 2 X 2,20 mm X 6,00 mts", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 22.00, costo_usd: null, stock_actual: 7 },
  { codigo: "TUB0201010", nombre: "TUBO PULIDO CUAD. 4 X 4 X 1,40 mm X 6,00 mts 2da", categoria: "TUBOS PULIDO CUADRADO", unidad: "Pza", precio_usd: 32.00, costo_usd: null, stock_actual: 65 },
  // === 23. TUBOS PULIDO RECTANGULAR ===
  { codigo: "TUB0202001", nombre: "TUBO PULIDO RECT. 1 1/2 X 1/2 X 0,90 X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 6.87, costo_usd: null, stock_actual: 193 },
  { codigo: "TUB0202004", nombre: "TUBO PULIDO RECT. 2 X 1 X 0,70 mm X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 7.90, costo_usd: null, stock_actual: 449 },
  { codigo: "TUB0202005", nombre: "TUBO PULIDO RECT. 2 X 1 X 0,90 mm X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 8.70, costo_usd: null, stock_actual: 116 },
  { codigo: "TUB0202014", nombre: "TUBO PULIDO RECT. 2 X 1 X 1,10 mm X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 10.89, costo_usd: null, stock_actual: 108 },
  { codigo: "TUB0202011", nombre: "TUBO PULIDO RECT. 3 X 1 X 0,90 mm X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 13.40, costo_usd: null, stock_actual: 30 },
  { codigo: "TUB0202012", nombre: "TUBO PULIDO RECT. 3 X 1 X 1,30 mm X 6,00 mts OFERTA", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 12.36, costo_usd: null, stock_actual: 1901 },
  { codigo: "TUB0202008", nombre: "TUBO PULIDO RECT. 3 X 1 1/2 X 0,90 mm X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 16.77, costo_usd: null, stock_actual: 66 },
  { codigo: "TUB0239001", nombre: "TUBO PULIDO RECT. 3 X 1 1/2 X 0,90 mm X 6,00 mts 2da", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 14.90, costo_usd: null, stock_actual: 12 },
  { codigo: "TUB0202010", nombre: "TUBO PULIDO RECT. 3 X 1 1/2 X 1.4 mm X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 23.00, costo_usd: null, stock_actual: 50 },
  { codigo: "TUB0202015", nombre: "TUBO PULIDO RECT. 3 X 1 X 1,90 mm X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 25.16, costo_usd: null, stock_actual: 24 },
  { codigo: "TUB0202013", nombre: "TUBO PULIDO RECT. 3 X 1 1/2 X 1.5 mm X 6,00 mts", categoria: "TUBOS PULIDO RECTANGULAR", unidad: "Pza", precio_usd: 23.00, costo_usd: null, stock_actual: 10 },
  // === 24. TUBOS GALVANIZADO ===
  { codigo: "TUB0403001", nombre: "TUBO GALV.  1/2 X 2,3mm X 5,80 mts", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 12.00, costo_usd: 9.95, stock_actual: 2199 },
  { codigo: "TUB0403002", nombre: "TUBO GALV.  1\" X 1,4mm X 3,00 mts EMT (ELECTRICO)", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 8.00, costo_usd: null, stock_actual: 836 },
  { codigo: "TUB0403009", nombre: "TUBO GALV. 1 1/4 X 6,60mts EMT PARA CERCA", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 8.70, costo_usd: null, stock_actual: 33 },
  { codigo: "TUB0403005", nombre: "TUBO GALV. C/ROSC. 1/2 X 2,3mm X 6,00 mts", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 17.00, costo_usd: 13.95, stock_actual: 2668 },
  { codigo: "TUB0403007", nombre: "TUBO GALV. C/ROSC. 3/4 X 6,00 mts ISO 150", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 26.00, costo_usd: 23.95, stock_actual: 118 },
  { codigo: "TUB0403003", nombre: "TUBO GALV. C/ROSC. 1  1/2 x 4mm X 5,90 mts", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 59.00, costo_usd: null, stock_actual: 3 },
  { codigo: "TUB0403004", nombre: "TUBO GALV. C/ROSC. 1  1/2 X 4mm X 6,40 mts", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 65.00, costo_usd: 45.00, stock_actual: 3 },
  { codigo: "TUB0403006", nombre: "TUBO GALV. C/ROSC. 2  1/4 X 4mm X 6,00 mts", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 79.00, costo_usd: 60.00, stock_actual: 6 },
  { codigo: "TUB0403008", nombre: "TUBO GALV. C/ROSC. 4\" X 2mm X 3,00 mts", categoria: "TUBOS GALVANIZADO", unidad: "Pza", precio_usd: 79.00, costo_usd: null, stock_actual: 8 },
  // === 26. TUBOS DE VENTILACION ===
  { codigo: "TUB1403001", nombre: "TUBO VENT. 1 1/2 X 2,00mm X 6,00 mts", categoria: "TUBOS DE VENTILACION", unidad: "Pza", precio_usd: 22.58, costo_usd: null, stock_actual: 55 },
  { codigo: "TUB1403002", nombre: "TUBO VENT. 1 1/2 X 2,60mm X 6,00 mts", categoria: "TUBOS DE VENTILACION", unidad: "Pza", precio_usd: 26.00, costo_usd: 19.00, stock_actual: 8 },
  { codigo: "TUB1403008", nombre: "TUBO VENT. 1  X 2,00mm X 6,00 mts", categoria: "TUBOS DE VENTILACION", unidad: "Pza", precio_usd: 13.65, costo_usd: null, stock_actual: 61 },
  { codigo: "TUB1403004", nombre: "TUBO VENT. 2 X 2,50mm X 6,00 mst", categoria: "TUBOS DE VENTILACION", unidad: "Pza", precio_usd: 37.80, costo_usd: null, stock_actual: 35 },
  { codigo: "TUB1403006", nombre: "TUBO VENT. 3 1/2\" X 2mm X 6,00 mts", categoria: "TUBOS DE VENTILACION", unidad: "Pza", precio_usd: 60.00, costo_usd: null, stock_actual: 3 },
  // === 27. TUBOS PVC ELECTRICOS ===
  { codigo: "TUB0903002", nombre: "TUBO ELEC. 1/2\" X 3,00 mts", categoria: "TUBOS PVC ELECTRICOS", unidad: "Pza", precio_usd: 2.90, costo_usd: 2.50, stock_actual: 3913 },
  { codigo: "TUB0903003", nombre: "TUBO ELEC. 3/4\" X 3,00 mts OCC PLAST", categoria: "TUBOS PVC ELECTRICOS", unidad: "Pza", precio_usd: 3.50, costo_usd: 2.90, stock_actual: 1339 },
  { codigo: "TUB0903006", nombre: "TUBO ELEC. 1 1/2 X 3,00 mts", categoria: "TUBOS PVC ELECTRICOS", unidad: "Pza", precio_usd: 6.50, costo_usd: 5.20, stock_actual: 195 },
  { codigo: "TUB0903005", nombre: "TUBO ELEC. 1\" X 3,00 mts TUBRICA", categoria: "TUBOS PVC ELECTRICOS", unidad: "Pza", precio_usd: 3.70, costo_usd: 4.50, stock_actual: 20 },
  { codigo: "TUB0903007", nombre: "TUBO ELEC. 2\" X 3,00 mts UNITECA", categoria: "TUBOS PVC ELECTRICOS", unidad: "Pza", precio_usd: 8.50, costo_usd: 6.90, stock_actual: 302 },
  { codigo: "TUB0903009", nombre: "TUBO ELEC. 4\" 114,0mm X ESP. 3,55mm X 6,00 mts REFORZADO", categoria: "TUBOS PVC ELECTRICOS", unidad: "Pza", precio_usd: 37.00, costo_usd: null, stock_actual: 468 },
  // === 28. TUBOS PVC AGUA FRIAS ===
  { codigo: "TUB0603002", nombre: "TUBO PVC A.F. 1/2 X 3,00 mts GRIS", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 3.95, costo_usd: 2.95, stock_actual: 922 },
  { codigo: "TUB0603003", nombre: "TUBO PVC A.F. 1/2 X 6,00 mts", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 7.90, costo_usd: 6.50, stock_actual: 797 },
  { codigo: "TUB0603009", nombre: "TUBO PVC A.F. 1/2 X 6,00 mts 9.500 PSI REFORZADO", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 8.90, costo_usd: 7.50, stock_actual: 521 },
  { codigo: "TUB0603007", nombre: "TUBO PVC A.F. 3/4 X 2,41mm X 6,00 mts ALTA PRESION *UNITECA *", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 9.50, costo_usd: 8.70, stock_actual: 192 },
  { codigo: "TUB0603008", nombre: "TUBO PVC A.F. 1\" X 6,00 mts NACIONAL", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 7.30, costo_usd: null, stock_actual: 47 },
  { codigo: "TUB0603001", nombre: "TUBO PVC A.F  1 1/2 X 6,00 mts", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 17.00, costo_usd: null, stock_actual: 298 },
  { codigo: "TUB0603012", nombre: "TUBO PVC A.F. 1 1/2 X 2,84mm  PRS 250 PSI X 6,00 mts   ASTM TUBRICA", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 27.00, costo_usd: null, stock_actual: 154 },
  { codigo: "TUB0603013", nombre: "TUBO PVC A.F. 1 1/2X 3,00mm PRESION 200 PSI X 6,00 mts *TUBRICA", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 23.00, costo_usd: null, stock_actual: 73 },
  { codigo: "TUB0603004", nombre: "TUBO PVC A.F. 2\" X 6,00 mts", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 23.00, costo_usd: null, stock_actual: 44 },
  { codigo: "TUB0603010", nombre: "TUBO PVC A.F. 2\" X 6,00 mts IMPORTADO", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 27.00, costo_usd: 21.00, stock_actual: 200 },
  { codigo: "TUB0603006", nombre: "TUBO PVC A.F. 2 1/2 X 3,48mm PRESION 200 PSI X 6,00 mts *TUBRICA", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 37.00, costo_usd: null, stock_actual: 60 },
  { codigo: "TUB0603011", nombre: "TUBO PVC A.F. 2 1/2\"X 3,60mm PRS  150 PSI  X 6,00 mts   ACUEDUCTO C", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 35.00, costo_usd: null, stock_actual: 93 },
  { codigo: "TUB0603005", nombre: "TUBO PVC A.F 3 X 6,00 mts GRIS", categoria: "TUBOS PVC AGUA FRIAS", unidad: "Pza", precio_usd: 35.00, costo_usd: 27.00, stock_actual: 10 },
  // === 29. TUBOS PVC AGUAS NEGRAS ===
  { codigo: "TUB0803002", nombre: "TUBO PVC A/N 2\" X 1,8 mm x 3,00 mts PAVCO", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 8.00, costo_usd: 5.50, stock_actual: 875 },
  { codigo: "TUB0803003", nombre: "TUBO PVC A/N 2\" X 1,8 mm x 3,00 mts SANALITE", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 7.50, costo_usd: 4.90, stock_actual: 66 },
  { codigo: "TUB0803004", nombre: "TUBO PVC A/N 2\" X 1,8 mm X 3,00 mts TUBRICA", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 8.00, costo_usd: 5.30, stock_actual: 124 },
  { codigo: "TUB0803006", nombre: "TUBO PVC A/N 2\" X 1,8 mm X 3,00 mts UNITECA", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 8.00, costo_usd: 5.40, stock_actual: 234 },
  { codigo: "TUB0803007", nombre: "TUBO PVC A/N 2\" X 3,00 mts DERIVADOS PLASTICOS", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 6.00, costo_usd: 4.60, stock_actual: 249 },
  { codigo: "TUB0803008", nombre: "TUBO PVC A/N 2\" X 3,00 mts  OCC PLAST", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 6.50, costo_usd: 4.50, stock_actual: 491 },
  { codigo: "TUB0803005", nombre: "TUBO PVC A/N 2\" X 3,9 mm  X 3,00 mts PAVCO REFORZADO", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 13.00, costo_usd: 10.41, stock_actual: 10 },
  { codigo: "TUB0803011", nombre: "TUBO PVC A/N 3\" X 3,00 mts IMP. CHARLLOTE PIPE", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 8.00, costo_usd: 5.40, stock_actual: 10 },
  { codigo: "TUB0803009", nombre: "TUBO PVC A/N 3\" X 3,00 mts  OCC PLAST", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 7.50, costo_usd: 5.40, stock_actual: 386 },
  { codigo: "TUB0803012", nombre: "TUBO PVC A/N 3\" X 3,00 mts DERIVADOS PLASTICOS", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 8.00, costo_usd: 5.90, stock_actual: 291 },
  { codigo: "TUB0803016", nombre: "TUBO PVC A/N 4\" X 3,2mm X 3,00 mts REFORZADO (NEGRO)", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 16.90, costo_usd: null, stock_actual: 80 },
  { codigo: "TUB0803014", nombre: "TUBO PVC A/N 6\" X 6,00 mts OCC PLAST", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 35.00, costo_usd: 32.00, stock_actual: 385 },
  { codigo: "TUB1503001", nombre: "TUBO PVC ALCANT. CORRUGADO 4\" X 6,00 mts", categoria: "TUBOS PVC AGUAS NEGRAS", unidad: "Pza", precio_usd: 52.00, costo_usd: 39.00, stock_actual: 20 },
  // === 30. VIGAS HE ===
  { codigo: "VIG0156001", nombre: "VIGA HEA 200 X 200 X 12,00 mts", categoria: "VIGAS HE", unidad: "Und", precio_usd: 787.40, costo_usd: 739.00, stock_actual: 20 },
  { codigo: "VIG0105001", nombre: "VIGA HEB 260 X 260 X 13,88 mts", categoria: "VIGAS HE", unidad: "Und", precio_usd: 1490.00, costo_usd: null, stock_actual: 19 },
  { codigo: "VIG0105002", nombre: "VIGA HEB 400 X 6,50 mts", categoria: "VIGAS HE", unidad: "Und", precio_usd: 1250.00, costo_usd: null, stock_actual: 5 },
  // === 31. VIGAS IPE ===
  { codigo: "VIG0106004", nombre: "VIGA IPE 80 X 12 mts", categoria: "VIGAS IPE", unidad: "Und", precio_usd: 105.78, costo_usd: 104.00, stock_actual: 36 },
  { codigo: "VIG0106005", nombre: "VIGA IPE 100 X 12 mts", categoria: "VIGAS IPE", unidad: "Und", precio_usd: 134.70, costo_usd: 129.00, stock_actual: 11 },
  { codigo: "VIG0106001", nombre: "VIGA IPE 160 X 90 X 5,75 mts", categoria: "VIGAS IPE", unidad: "Und", precio_usd: 90.00, costo_usd: null, stock_actual: 73 },
  { codigo: "VIG0106002", nombre: "VIGA IPE 250 X 130 X 5,75 mts", categoria: "VIGAS IPE", unidad: "Und", precio_usd: 190.00, costo_usd: null, stock_actual: 79 },
  { codigo: "VIG0106006", nombre: "VIGA IPE 100 X 6 mts", categoria: "VIGAS IPE", unidad: "Und", precio_usd: 67.35, costo_usd: null, stock_actual: 1 },
  // === 32. VIGAS IPN ===
  { codigo: "VIG0107001", nombre: "VIGA IPN 100 X 2,04 mts", categoria: "VIGAS IPN", unidad: "Und", precio_usd: 28.00, costo_usd: null, stock_actual: 3 },
  { codigo: "VIG0107002", nombre: "VIGA IPN 120 X 12,00 mts", categoria: "VIGAS IPN", unidad: "Und", precio_usd: 190.97, costo_usd: null, stock_actual: 42 },
  { codigo: "VIG0107004", nombre: "VIGA IPN 140 X 4,00 mts", categoria: "VIGAS IPN", unidad: "Und", precio_usd: 30.00, costo_usd: null, stock_actual: 4 },
  { codigo: "VIG0107005", nombre: "VIGA IPN 140 X 5,00 mts", categoria: "VIGAS IPN", unidad: "Und", precio_usd: 32.00, costo_usd: null, stock_actual: 4 },
  { codigo: "VIG0107006", nombre: "VIGA IPN 240 X 12,00 mts", categoria: "VIGAS IPN", unidad: "Und", precio_usd: 580.00, costo_usd: null, stock_actual: 46 },
  // === 33. VIGAS UPL ===
  { codigo: "VIG0108001", nombre: "VIGA UPL 100 X 12 mts", categoria: "VIGAS UPL", unidad: "Und", precio_usd: 145.77, costo_usd: null, stock_actual: 31 },
  // === 34. VIGAS VP ===
  { codigo: "VIG0109001", nombre: "VIGA VP 350 X 4,10 mts", categoria: "VIGAS VP", unidad: "Und", precio_usd: 140.00, costo_usd: null, stock_actual: 5 },
  { codigo: "VIG0109002", nombre: "VIGA VP 350 X 7,13,00 mts", categoria: "VIGAS VP", unidad: "Und", precio_usd: 290.00, costo_usd: null, stock_actual: 9 },
  { codigo: "VIG0109003", nombre: "VIGA VP 400 X 4,90 mts", categoria: "VIGAS VP", unidad: "Und", precio_usd: 240.00, costo_usd: null, stock_actual: 12 },
  // === 35. CONEXIONES ADAPTADO ===
  { codigo: "CON0920001", nombre: "ADAPTADOR TERM CONDUIT 1\" TUBRICA", categoria: "CONEXIONES ADAPTADO", unidad: "Und", precio_usd: 0.35, costo_usd: null, stock_actual: 3800 },
  // === 36. CONEXIONES ANILLOS ===
  { codigo: "CON0621002", nombre: "ANILLO A.F 1/2", categoria: "CONEXIONES ANILLOS", unidad: "Und", precio_usd: 0.30, costo_usd: null, stock_actual: 10731 },
  { codigo: "CON0621003", nombre: "ANILLO A.F 3/4", categoria: "CONEXIONES ANILLOS", unidad: "Und", precio_usd: 0.32, costo_usd: null, stock_actual: 3985 },
  { codigo: "CON0621001", nombre: "ANILLO A.F 1\"", categoria: "CONEXIONES ANILLOS", unidad: "Und", precio_usd: 0.38, costo_usd: null, stock_actual: 986 },
  { codigo: "CON0821001", nombre: "ANILLO A.N 2\" TUBRICA     *", categoria: "CONEXIONES ANILLOS", unidad: "Und", precio_usd: 0.98, costo_usd: null, stock_actual: 799 },
  { codigo: "CON0821002", nombre: "ANILLO A.N 3\"", categoria: "CONEXIONES ANILLOS", unidad: "Und", precio_usd: 1.45, costo_usd: null, stock_actual: 180 },
  { codigo: "CON0421001", nombre: "ANILLO EMT 1\"", categoria: "CONEXIONES ANILLOS", unidad: "Und", precio_usd: 3.50, costo_usd: null, stock_actual: 87 },
  // === 37. CONEXIONES CODOS ===
  { codigo: "CON0622001", nombre: "CODO A.F 1/2 X 45 NACIONAL", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 0.50, costo_usd: null, stock_actual: 246 },
  { codigo: "CON0622003", nombre: "CODO A.F 1 1/2 X 90 ALTA PRESION TUBRICA", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 3.90, costo_usd: null, stock_actual: 668 },
  { codigo: "CON0822001", nombre: "CODO A.N 2\" X 45 TUBRICA", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 1.35, costo_usd: null, stock_actual: 1625 },
  { codigo: "CON0822002", nombre: "CODO A.N 2\" X 90 BETAPLAST", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 1.40, costo_usd: null, stock_actual: 84 },
  { codigo: "CON0822003", nombre: "CODO A.N 2\" X 90 IMPORTADO", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 1.90, costo_usd: 1.70, stock_actual: 27 },
  { codigo: "CON0822004", nombre: "CODO A.N 2\" X 90 TUBRICA", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 1.90, costo_usd: 1.70, stock_actual: 36 },
  { codigo: "CON0822005", nombre: "CODO A.N 3\" X 45 TUBRICA", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 2.10, costo_usd: 1.85, stock_actual: 177 },
  { codigo: "CON0822006", nombre: "CODO A.N 3\" X 90 NACIONAL", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 2.10, costo_usd: 1.85, stock_actual: 345 },
  { codigo: "CON0822007", nombre: "CODO A.N 4\" X 45 TUBRICA", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 4.50, costo_usd: 3.10, stock_actual: 6636 },
  { codigo: "CON0822008", nombre: "CODO A.N 4\" X 90 TUBRICA", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 4.50, costo_usd: 3.40, stock_actual: 2717 },
  { codigo: "CON0822010", nombre: "CODO A.N 6\" X 90 NACIONAL", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 13.00, costo_usd: 9.00, stock_actual: 340 },
  { codigo: "CON0622002", nombre: "CODO CPVC 1/2 X 90 NACIONAL", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 0.80, costo_usd: 0.60, stock_actual: 300 },
  { codigo: "CON0422001", nombre: "CODO HG 1\" X 45", categoria: "CONEXIONES CODOS", unidad: "Und", precio_usd: 1.50, costo_usd: 1.30, stock_actual: 53 },
  // === 38. CONEXIONES CURVAS ===
  { codigo: "CON0923003", nombre: "CURVA CONDUIT 1/2 X 90\"", categoria: "CONEXIONES CURVAS", unidad: "Und", precio_usd: 0.70, costo_usd: null, stock_actual: 6248 },
  { codigo: "CON0923004", nombre: "CURVA CONDUIT 1/2\" X 90 REFORZADO", categoria: "CONEXIONES CURVAS", unidad: "Und", precio_usd: 1.45, costo_usd: null, stock_actual: 72 },
  { codigo: "CON0923007", nombre: "CURVA CONDUIT 3/4\" X 90 REFORZADO", categoria: "CONEXIONES CURVAS", unidad: "Und", precio_usd: 0.99, costo_usd: 0.85, stock_actual: 15790 },
  { codigo: "CON0923002", nombre: "CURVA CONDUIT 1\" X 90 REFORZADO", categoria: "CONEXIONES CURVAS", unidad: "Und", precio_usd: 1.20, costo_usd: 0.95, stock_actual: 740 },
  { codigo: "CON0923001", nombre: "CURVA CONDUIT 1 1/2\" X 90 REFORZADO", categoria: "CONEXIONES CURVAS", unidad: "Und", precio_usd: 4.50, costo_usd: 3.50, stock_actual: 1482 },
  { codigo: "CON0923005", nombre: "CURVA CONDUIT 2\" X 90 NACIONAL", categoria: "CONEXIONES CURVAS", unidad: "Und", precio_usd: 5.50, costo_usd: 3.90, stock_actual: 161 },
  { codigo: "CON0923006", nombre: "CURVA CONDUIT 2\" X 90 REFORZADO", categoria: "CONEXIONES CURVAS", unidad: "Und", precio_usd: 4.20, costo_usd: null, stock_actual: 585 },
  // === 39. CONEXIONES JUNTAS ===
  { codigo: "CON0624002", nombre: "JUNTA DRESSER 1/2", categoria: "CONEXIONES JUNTAS", unidad: "Und", precio_usd: 0.65, costo_usd: null, stock_actual: 995 },
  { codigo: "CON0624001", nombre: "JUNTA DRESSER 3/4", categoria: "CONEXIONES JUNTAS", unidad: "Und", precio_usd: 0.85, costo_usd: null, stock_actual: 2569 },
  { codigo: "CON0424001", nombre: "JUNTA DRESSER HG 1/2\"", categoria: "CONEXIONES JUNTAS", unidad: "Und", precio_usd: 1.60, costo_usd: 1.30, stock_actual: 315 },
  { codigo: "CON0424002", nombre: "JUNTA DRESSER HG 3/4\"", categoria: "CONEXIONES JUNTAS", unidad: "Und", precio_usd: 1.80, costo_usd: 1.50, stock_actual: 233 },
  // === 40. CONEXIONES NIPLES ===
  { codigo: "CON0425001", nombre: "NIPLE GALV 1/2 X 4 cm", categoria: "CONEXIONES NIPLES", unidad: "Und", precio_usd: 0.65, costo_usd: null, stock_actual: 340 },
  { codigo: "CON0425002", nombre: "NIPLE GALV 1/2 X 5 cm", categoria: "CONEXIONES NIPLES", unidad: "Und", precio_usd: 0.75, costo_usd: null, stock_actual: 29 },
  { codigo: "CON0425003", nombre: "NIPLE GALV 1/2 X 10 cm", categoria: "CONEXIONES NIPLES", unidad: "Und", precio_usd: 0.85, costo_usd: null, stock_actual: 17 },
  // === 41. CONEXIONES REDUCCIONES ===
  { codigo: "CON0826001", nombre: "REDUCCION A.N 3 X 2", categoria: "CONEXIONES REDUCCIONES", unidad: "Und", precio_usd: 2.80, costo_usd: 2.20, stock_actual: 26 },
  { codigo: "CON0826002", nombre: "REDUCCION A.N 4 X 2 TUBRICA", categoria: "CONEXIONES REDUCCIONES", unidad: "Und", precio_usd: 3.00, costo_usd: 2.60, stock_actual: 621 },
  // === 42. CONEXIONES SIFONES ===
  { codigo: "CON0831001", nombre: "SIFON A.N 2\" TUBRICA", categoria: "CONEXIONES SIFONES", unidad: "Und", precio_usd: 1.30, costo_usd: 1.09, stock_actual: 1972 },
  { codigo: "CON0831002", nombre: "SIFON A.N 4\" TUBRICA", categoria: "CONEXIONES SIFONES", unidad: "Und", precio_usd: 2.90, costo_usd: 2.50, stock_actual: 3 },
  // === 43. CONEXIONES TAPONES ===
  { codigo: "CON0427001", nombre: "TAPON GALV 1/2 MACHO", categoria: "CONEXIONES TAPONES", unidad: "Und", precio_usd: 0.72, costo_usd: null, stock_actual: 70 },
  { codigo: "CON0427002", nombre: "TAPON GALV 1/2 ROSC", categoria: "CONEXIONES TAPONES", unidad: "Und", precio_usd: 0.73, costo_usd: null, stock_actual: 739 },
  // === 44. CONEXIONES TEE ===
  { codigo: "CON0828001", nombre: "TEE A.N 2\" TUBRICA", categoria: "CONEXIONES TEE", unidad: "Und", precio_usd: 1.80, costo_usd: 1.25, stock_actual: 2264 },
  { codigo: "CON0828002", nombre: "TEE A.N 4\" TUBRICA", categoria: "CONEXIONES TEE", unidad: "Und", precio_usd: 4.50, costo_usd: 3.90, stock_actual: 851 },
  { codigo: "CON0628001", nombre: "TEE A.F 1/2 LISA", categoria: "CONEXIONES TEE", unidad: "Und", precio_usd: 0.45, costo_usd: 0.35, stock_actual: 360 },
  { codigo: "CON0628002", nombre: "TEE A.F 1/2 ROSC", categoria: "CONEXIONES TEE", unidad: "Und", precio_usd: 0.35, costo_usd: null, stock_actual: 29 },
  { codigo: "CON0828004", nombre: "TEE RED A.N 4 X 2 TUBRICA", categoria: "CONEXIONES TEE", unidad: "Und", precio_usd: 4.50, costo_usd: 3.50, stock_actual: 42 },
  { codigo: "CON0828003", nombre: "TEE RED A.N 4 X 3 TUBRICA", categoria: "CONEXIONES TEE", unidad: "Und", precio_usd: 4.50, costo_usd: 3.20, stock_actual: 257 },
  { codigo: "CON0828005", nombre: "TEE RED A.N 6 X 4 TUBRICA", categoria: "CONEXIONES TEE", unidad: "Und", precio_usd: 13.00, costo_usd: 8.90, stock_actual: 76 },
  // === 45. CONEXIONES UNION ===
  { codigo: "CON0629001", nombre: "UNION CPVC A.C 1/2", categoria: "CONEXIONES UNION", unidad: "Und", precio_usd: 0.30, costo_usd: 0.18, stock_actual: 4293 },
  { codigo: "CON0929008", nombre: "UNION CONDUIT 1\"", categoria: "CONEXIONES UNION", unidad: "Und", precio_usd: 0.60, costo_usd: 0.12, stock_actual: 2582 },
  { codigo: "CON0429001", nombre: "UNION EMT 1\"", categoria: "CONEXIONES UNION", unidad: "Und", precio_usd: 0.80, costo_usd: 0.22, stock_actual: 624 },
  { codigo: "CON0629003", nombre: "UNION LISA A.F  1/2\" TUBRICA", categoria: "CONEXIONES UNION", unidad: "Und", precio_usd: 1.30, costo_usd: 1.04, stock_actual: 3770 },
  { codigo: "CON0629004", nombre: "UNION LISA A.F  1/2\" UNIVERSAL", categoria: "CONEXIONES UNION", unidad: "Und", precio_usd: 0.60, costo_usd: 0.45, stock_actual: 2381 },
  { codigo: "CON0629002", nombre: "UNION LISA A.F  3/4\" TUBRICA", categoria: "CONEXIONES UNION", unidad: "Und", precio_usd: 0.60, costo_usd: 0.45, stock_actual: 497 },
  // === 46. CONEXIONES YEE ===
  { codigo: "CON0830002", nombre: "YEE A.N 4\" TUBRICA", categoria: "CONEXIONES YEE", unidad: "Und", precio_usd: 5.50, costo_usd: 4.50, stock_actual: 880 },
  { codigo: "CON0830003", nombre: "YEE A.N 6\" NACIONAL", categoria: "CONEXIONES YEE", unidad: "Und", precio_usd: 12.00, costo_usd: 9.50, stock_actual: 69 },
  { codigo: "CON0830005", nombre: "YEE RED A.N 4\" X 2 TUBRICA", categoria: "CONEXIONES YEE", unidad: "Und", precio_usd: 4.50, costo_usd: 3.50, stock_actual: 6909 },
  { codigo: "CON0830004", nombre: "YEE RED A.N 4\" X 3 TUBRICA", categoria: "CONEXIONES YEE", unidad: "Und", precio_usd: 4.50, costo_usd: 4.00, stock_actual: 117 },
  { codigo: "CON0830001", nombre: "YEE RED A.N 6\" X 4 TUBRICA", categoria: "CONEXIONES YEE", unidad: "Und", precio_usd: 9.50, costo_usd: null, stock_actual: 260 },
  // === 47. ELECTRICIDAD ===
  { codigo: "ELE1603001", nombre: "ARVIDAL 1/0", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 7.50, costo_usd: null, stock_actual: 2366 },
  { codigo: "ELE1603002", nombre: "ARVIDAL 2/0", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 7.50, costo_usd: null, stock_actual: 4079 },
  { codigo: "ELE1848001", nombre: "BREAKER QO EMPOTRABLE 1 X 20 AMP", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 6.90, costo_usd: null, stock_actual: 1223 },
  { codigo: "ELE1847001", nombre: "BREAKER QO SUPERFICIAL 1 X 20 AMP", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 7.60, costo_usd: null, stock_actual: 29 },
  { codigo: "ELE1848002", nombre: "BREAKER THQC EMPOTRABLE 2 X 60 AMP", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 9.90, costo_usd: null, stock_actual: 627 },
  { codigo: "ELE0433001", nombre: "CAJA DE MEDIDOR 40 X 30 X 20", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 17.00, costo_usd: null, stock_actual: 1284 },
  { codigo: "ELE0433002", nombre: "CAJA DE PASO ELECTRICA 6 X 6 X 6  GALV", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 14.00, costo_usd: null, stock_actual: 191 },
  { codigo: "ELE0933001", nombre: "CAJA DE PASO ELECTRICA 8 X 8 X 8 PVC", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 11.00, costo_usd: null, stock_actual: 198 },
  { codigo: "ELE0433003", nombre: "CAJETIN 4 X 2 RECTANGULAR EMT", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 0.90, costo_usd: null, stock_actual: 15280 },
  { codigo: "ELE0433004", nombre: "CAJETIN 4 X 4 CUADRADO EMT", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 1.30, costo_usd: null, stock_actual: 237 },
  { codigo: "ELE0933002", nombre: "CAJETIN 4 X 4 CUADRADO PVC", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 0.45, costo_usd: null, stock_actual: 2000 },
  { codigo: "ELE0433005", nombre: "CAJETIN 4 X 4 OCTAGONAL EMT", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 1.30, costo_usd: null, stock_actual: 2000 },
  { codigo: "ELE0933003", nombre: "CAJETIN 4 X 4 OCTAGONAL PVC", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 0.45, costo_usd: null, stock_actual: 1996 },
  { codigo: "ELE0434006", nombre: "TABLERO 20 CIRCUITOS", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 170.00, costo_usd: null, stock_actual: 90 },
  { codigo: "ELE0434007", nombre: "TAPA PARA TABLERO 20 CIRCUITOS", categoria: "ELECTRICIDAD", unidad: "Und", precio_usd: 70.00, costo_usd: null, stock_actual: 20 },
  // === 48. ELECTRICIDAD CABLES ===
  { codigo: "ELE1732002", nombre: "CABLE ELECTRICO THW #2  NEGRO IMPORTADO", categoria: "ELECTRICIDAD CABLES", unidad: "Mts", precio_usd: 4.75, costo_usd: null, stock_actual: 28 },
  { codigo: "ELE1732003", nombre: "CABLE ELECTRICO THW #2 AMARILLO IMPORTADO", categoria: "ELECTRICIDAD CABLES", unidad: "Mts", precio_usd: 4.75, costo_usd: null, stock_actual: 582 },
  { codigo: "ELE1732004", nombre: "CABLE ELECTRICO THW #2 VERDE IMPORTADO", categoria: "ELECTRICIDAD CABLES", unidad: "Mts", precio_usd: 4.75, costo_usd: null, stock_actual: 120 },
  { codigo: "ELE1738001", nombre: "ROLLO DE CABLE ELECTRICO THW #4  ROJO NACIONAL", categoria: "ELECTRICIDAD CABLES", unidad: "Rollo", precio_usd: 4.50, costo_usd: null, stock_actual: 1 },
  { codigo: "ELE1738002", nombre: "ROLLO DE CABLE ELECTRICO THW #4 BLANCO IMPORTADO", categoria: "ELECTRICIDAD CABLES", unidad: "Rollo", precio_usd: 3.60, costo_usd: null, stock_actual: 12 },
  { codigo: "ELE1738004", nombre: "ROLLO DE CABLE ELECTRICO THWN #4  BLANCO NACIONAL PHELPSDODGE", categoria: "ELECTRICIDAD CABLES", unidad: "Rollo", precio_usd: 5.90, costo_usd: null, stock_actual: 1 },
  // === 49. FERRETERIA ===
  { codigo: "FER0137004", nombre: "TOR A325 HEX GALV CALIENTE NC 5/8 X 2\" 200 Grs.", categoria: "FERRETERIA", unidad: "Und", precio_usd: 2.80, costo_usd: null, stock_actual: 2498 },
  { codigo: "FER0137003", nombre: "TOR A325 HEX GALV CALIENTE NC 5/8 X 2 1/2 300 Grs.", categoria: "FERRETERIA", unidad: "Und", precio_usd: 4.50, costo_usd: 3.20, stock_actual: 5000 },
  { codigo: "FER0137001", nombre: "TOR A325 HEX GALV CALIENTE NC 1\" x 3 1/2 600 Grs.", categoria: "FERRETERIA", unidad: "Und", precio_usd: 6.20, costo_usd: 4.06, stock_actual: 5000 },
  { codigo: "FER0137002", nombre: "TOR A325 HEX GALV CALIENTE NC 1\" X 4\" 700 Grs.", categoria: "FERRETERIA", unidad: "Und", precio_usd: 7.90, costo_usd: 4.70, stock_actual: 17134 },
  { codigo: "FER0137006", nombre: "TOR C. HEX 5/8 X 3\"", categoria: "FERRETERIA", unidad: "Und", precio_usd: 0.70, costo_usd: 0.58, stock_actual: 382 },
  { codigo: "FER0137005", nombre: "TOR C. HEX 1/2 X 2 1/2", categoria: "FERRETERIA", unidad: "Und", precio_usd: 0.45, costo_usd: 0.31, stock_actual: 1600 },
  { codigo: "FER0142002", nombre: "CLAVO FERROSO 1\"", categoria: "FERRETERIA", unidad: "Kg", precio_usd: 7.30, costo_usd: null, stock_actual: 71 },
  { codigo: "FER0142001", nombre: "CLAVO ACERO 2\"", categoria: "FERRETERIA", unidad: "Kg", precio_usd: 9.70, costo_usd: null, stock_actual: 74 },
  { codigo: "FER1652001", nombre: "REJILLA A.N 2\" ALUMINIO", categoria: "FERRETERIA", unidad: "Und", precio_usd: 3.50, costo_usd: 2.90, stock_actual: 2989 },
  { codigo: "FER0852001", nombre: "REJILLA A.N 4\" PVC", categoria: "FERRETERIA", unidad: "Und", precio_usd: 2.50, costo_usd: 1.90, stock_actual: 500 },
  { codigo: "FER2152001", nombre: "REJILLA A.N 4\" BRONCE", categoria: "FERRETERIA", unidad: "Und", precio_usd: 4.50, costo_usd: 3.40, stock_actual: 20 },
  { codigo: "FER1003001", nombre: "DISCO DE CORTE 4 1/2", categoria: "FERRETERIA", unidad: "Und", precio_usd: 0.74, costo_usd: null, stock_actual: 39 },
  { codigo: "FER1003002", nombre: "DISCO DE CORTE 7\" X 1/16", categoria: "FERRETERIA", unidad: "Und", precio_usd: 1.35, costo_usd: null, stock_actual: 6 },
  { codigo: "FER1003003", nombre: "DISCO DE ESMERILAR 4 1/2", categoria: "FERRETERIA", unidad: "Und", precio_usd: 1.26, costo_usd: null, stock_actual: 24 },
  { codigo: "FER1003004", nombre: "DISCO DE ESMERILAR 7\" X 1/16", categoria: "FERRETERIA", unidad: "Und", precio_usd: 2.94, costo_usd: null, stock_actual: 23 },
  { codigo: "FER1003005", nombre: "DISCO DE TRONZADORA 14\"", categoria: "FERRETERIA", unidad: "Und", precio_usd: 5.46, costo_usd: null, stock_actual: 27 },
  { codigo: "FER1050001", nombre: "ARNES ANTI-CAIDAS", categoria: "FERRETERIA", unidad: "Und", precio_usd: 18.00, costo_usd: null, stock_actual: 267 },
  { codigo: "FER1051003", nombre: "ELECTRODO 6013 1/8 KEEP DRY", categoria: "FERRETERIA", unidad: "Kg", precio_usd: 2.50, costo_usd: null, stock_actual: 4234 },
  { codigo: "FER1051001", nombre: "ELECTRODO 7018 1/8 GRICON", categoria: "FERRETERIA", unidad: "Kg", precio_usd: 3.90, costo_usd: null, stock_actual: 71 },
  { codigo: "FER1051002", nombre: "ELECTRODO 532 7 1/8 GRICON", categoria: "FERRETERIA", unidad: "Kg", precio_usd: 3.50, costo_usd: null, stock_actual: 229 },
  { codigo: "FER2052001", nombre: "PEGA PROF. PARA PVC  DE ALTA PRESION ERA G-GOOD 946 ML A.C", categoria: "FERRETERIA", unidad: "Und", precio_usd: 25.00, costo_usd: null, stock_actual: 34 },
  { codigo: "FER2249001", nombre: "KIT DE CERRADURA DE EMBUTIR (CILINDRO , MANILLA)", categoria: "FERRETERIA", unidad: "Und", precio_usd: null, costo_usd: null, stock_actual: 30 },
  { codigo: "FER2249002", nombre: "KIT DE FREGADERO (1 FREGADERO DOBLE, 1 BAJANTE DOBLE, 2 DESAGUE, 2 LLAVE ARRESTO, 5 SARGENTO PEQ 1 GRIFERIA)", categoria: "FERRETERIA", unidad: "Kit", precio_usd: 120.00, costo_usd: null, stock_actual: 50 },
];

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": options.prefer || "return=representation",
      ...options.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log(`\n=== SINCRONIZACIÓN DE INVENTARIO ===`);
  console.log(`Productos en el PDF: ${pdfProducts.length}`);

  // Fetch all current products
  const dbProducts = await supabaseFetch("productos?select=id,codigo,nombre,precio_usd,costo_usd,stock_actual,imagen_url,activo&order=codigo");
  console.log(`Productos en la base de datos: ${dbProducts.length}`);

  const dbMap = new Map();
  for (const p of dbProducts) {
    if (p.codigo) dbMap.set(p.codigo.trim(), p);
  }

  let updated = 0;
  let inserted = 0;
  let unchanged = 0;
  let errors = 0;
  const noImage = [];

  for (const pdf of pdfProducts) {
    const existing = dbMap.get(pdf.codigo.trim());

    if (existing) {
      // Build update payload - only include fields that changed
      const updates = {};

      if (pdf.precio_usd !== null && pdf.precio_usd !== existing.precio_usd) {
        updates.precio_usd = pdf.precio_usd;
      }
      if (pdf.costo_usd !== null && pdf.costo_usd !== existing.costo_usd) {
        updates.costo_usd = pdf.costo_usd;
      }
      if (pdf.stock_actual !== existing.stock_actual) {
        updates.stock_actual = pdf.stock_actual;
      }
      // Update category if different
      if (pdf.categoria) {
        updates.categoria = pdf.categoria;
      }
      updates.actualizado_en = new Date().toISOString();

      if (Object.keys(updates).length > 1) { // more than just actualizado_en
        try {
          await supabaseFetch(`productos?id=eq.${existing.id}`, {
            method: "PATCH",
            body: JSON.stringify(updates),
          });
          updated++;
          const changes = Object.keys(updates).filter(k => k !== 'actualizado_en').join(', ');
          console.log(`  ✓ UPDATED ${pdf.codigo}: ${changes}`);
        } catch (e) {
          errors++;
          console.error(`  ✗ ERROR updating ${pdf.codigo}: ${e.message}`);
        }
      } else {
        unchanged++;
      }

      if (!existing.imagen_url) {
        noImage.push({ codigo: pdf.codigo, nombre: pdf.nombre, id: existing.id, categoria: pdf.categoria });
      }
    } else {
      // Insert new product
      const newProduct = {
        codigo: pdf.codigo,
        nombre: pdf.nombre,
        categoria: pdf.categoria,
        unidad: pdf.unidad || "Und",
        precio_usd: pdf.precio_usd || 0,
        costo_usd: pdf.costo_usd || null,
        stock_actual: pdf.stock_actual || 0,
        stock_minimo: 0,
        activo: true,
      };
      try {
        const result = await supabaseFetch("productos", {
          method: "POST",
          body: JSON.stringify(newProduct),
        });
        inserted++;
        console.log(`  + INSERTED ${pdf.codigo}: ${pdf.nombre}`);
        if (result && result[0]) {
          noImage.push({ codigo: pdf.codigo, nombre: pdf.nombre, id: result[0].id, categoria: pdf.categoria });
        }
      } catch (e) {
        errors++;
        console.error(`  ✗ ERROR inserting ${pdf.codigo}: ${e.message}`);
      }
    }
  }

  console.log(`\n=== RESUMEN ===`);
  console.log(`Actualizados: ${updated}`);
  console.log(`Insertados: ${inserted}`);
  console.log(`Sin cambios: ${unchanged}`);
  console.log(`Errores: ${errors}`);
  console.log(`Sin imagen: ${noImage.length}`);

  if (noImage.length > 0) {
    console.log(`\n=== PRODUCTOS SIN IMAGEN ===`);
    for (const p of noImage) {
      console.log(`  ${p.codigo} | ${p.nombre} | ${p.id}`);
    }
  }
}

main().catch(console.error);
