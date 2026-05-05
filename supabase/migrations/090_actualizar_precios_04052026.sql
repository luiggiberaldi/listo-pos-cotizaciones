-- Actualización de precios, stock y categorías - 04/05/2026
-- Generado automáticamente desde LISTA DE PRECIOS 04-05-2026
-- Se actualiza por codigo (campo único). Solo toca precio_usd, precio_2, stock_actual, categoria.

BEGIN;

UPDATE productos SET precio_usd = 9.98, precio_2 = NULL, stock_actual = 2154, categoria = 'CEMENTO' WHERE codigo = 'CEM1045001'; -- CEMENTO GRIS ENSACADO
UPDATE productos SET precio_usd = 1.98, precio_2 = NULL, stock_actual = 4622, categoria = 'ALAMBRE' WHERE codigo = 'ALA0403001'; -- ALAMBRE GALVANIZADO CALIBRE 18
UPDATE productos SET precio_usd = 1.49, precio_2 = 1.29, stock_actual = 75588, categoria = 'ALAMBRON' WHERE codigo = 'ALB0141005'; -- ALAMBRON 5,2 mm X 6 mts
UPDATE productos SET precio_usd = 1.9, precio_2 = NULL, stock_actual = 41, categoria = 'ALAMBRON' WHERE codigo = 'ALB0141006'; -- ALAMBRON 6,0 mm X 6 mts
UPDATE productos SET precio_usd = 2.9, precio_2 = NULL, stock_actual = 3, categoria = 'ALAMBRON' WHERE codigo = 'ALB0141001'; -- ALAMBRON 7,0 mm X 6 mts
UPDATE productos SET precio_usd = 8.58, precio_2 = 7.5, stock_actual = 2590, categoria = 'BARRAS' WHERE codigo = 'BAR0101001'; -- BARRA CUADRADA LISA 12mm X 6,00 mts
UPDATE productos SET precio_usd = 4.4, precio_2 = 3.16, stock_actual = 9655, categoria = 'BARRAS' WHERE codigo = 'BAR0103001'; -- BARRA REDONDA LISA 10mm X 6,00 mts
UPDATE productos SET precio_usd = 7.34, precio_2 = 6.66, stock_actual = 2637, categoria = 'BARRAS' WHERE codigo = 'BAR0103002'; -- BARRA REDONDA LISA 12mm X 6,00 mts
UPDATE productos SET precio_usd = 9, precio_2 = NULL, stock_actual = 4803, categoria = 'CABILLAS' WHERE codigo = 'CAB0114004'; -- CABILLA ESTRIADA 3/8 X 12,00 mts SIDETUR
UPDATE productos SET precio_usd = 4.5, precio_2 = NULL, stock_actual = 274, categoria = 'CABILLAS' WHERE codigo = 'CAB0114005'; -- CABILLA ESTRIADA 3/8 X 6,00 mts SIDETUR
UPDATE productos SET precio_usd = 12, precio_2 = NULL, stock_actual = 0, categoria = 'CABILLAS' WHERE codigo = 'CAB0114006'; -- CABILLA ESTRIADA 1/2 X 12,00 mts SIDETUR
UPDATE productos SET precio_usd = 12, precio_2 = NULL, stock_actual = 0, categoria = 'CABILLAS' WHERE codigo = 'CAB0114010'; -- CABILLA ESTRIADA 1/2 X 12,00 mts SIDOR
UPDATE productos SET precio_usd = 6, precio_2 = NULL, stock_actual = 4117, categoria = 'CABILLAS' WHERE codigo = 'CAB0114007'; -- CABILLA ESTRIADA 1/2 X 6,00 mts SIDETUR
UPDATE productos SET precio_usd = 22, precio_2 = NULL, stock_actual = 100, categoria = 'CABILLAS' WHERE codigo = 'CAB0114009'; -- CABILLA ESTRIADA 5/8 X 12,00 mts SIDETUR
UPDATE productos SET precio_usd = 42, precio_2 = 38, stock_actual = 1, categoria = 'CABILLAS' WHERE codigo = 'CAB0114001'; -- CABILLA ESTRIADA 1" X 12,00 mts LEVE OXIDO
UPDATE productos SET precio_usd = 45, precio_2 = 44, stock_actual = 25, categoria = 'CABILLAS' WHERE codigo = 'CAB0114015'; -- CABILLA ESTRIADA 1" X 12,00 mts SIDETUR
UPDATE productos SET precio_usd = 8.5, precio_2 = 7.9, stock_actual = 2006, categoria = 'CERCHAS' WHERE codigo = 'CER0100001'; -- CERCHAS 10mm X 6 mts
UPDATE productos SET precio_usd = 8.9, precio_2 = 8.5, stock_actual = 566, categoria = 'CERCHAS' WHERE codigo = 'CER0100002'; -- CERCHAS 15mm X 6 mts
UPDATE productos SET precio_usd = 7.5, precio_2 = NULL, stock_actual = 387, categoria = 'FLANCHE' WHERE codigo = 'FLA0101001'; -- FLANCHE 20 X 20 X 12 mm
UPDATE productos SET precio_usd = 72, precio_2 = 69, stock_actual = 35, categoria = 'LAMINAS HIERRO NEGRO' WHERE codigo = 'LAM0113007'; -- LAMINA HN 2,50 mm X 1,250 X 2,40 m
UPDATE productos SET precio_usd = 87, precio_2 = NULL, stock_actual = 54, categoria = 'LAMINAS HIERRO NEGRO' WHERE codigo = 'LAM0113001'; -- LAMINA HN 3,00 mm X 1,250 X 2,40 m
UPDATE productos SET precio_usd = 138.71, precio_2 = NULL, stock_actual = 4, categoria = 'LAMINAS HIERRO NEGRO' WHERE codigo = 'LAM0113008'; -- LAMINA HN 5,00 mm X 1,005 X 2,40 m
UPDATE productos SET precio_usd = 147.8, precio_2 = NULL, stock_actual = 8, categoria = 'LAMINAS HIERRO NEGRO' WHERE codigo = 'LAM0113002'; -- LAMINA HN 5,00 mm X 1,200 X 2,40 m
UPDATE productos SET precio_usd = 145, precio_2 = NULL, stock_actual = 5, categoria = 'LAMINAS HIERRO NEGRO' WHERE codigo = 'LAM0113003'; -- LAMINA HN 5,00 mm X 1,205 X 2,40 m
UPDATE productos SET precio_usd = 129, precio_2 = NULL, stock_actual = 3, categoria = 'LAMINAS HIERRO NEGRO' WHERE codigo = 'LAM0113004'; -- LAMINA HN 6,00 mm X 1,005 X 2,00 m
UPDATE productos SET precio_usd = 167, precio_2 = NULL, stock_actual = 1, categoria = 'LAMINAS HIERRO NEGRO' WHERE codigo = 'LAM0113005'; -- LAMINA HN 6,00 mm X 1,205 X 2,40 m
UPDATE productos SET precio_usd = 331.78, precio_2 = NULL, stock_actual = 1, categoria = 'LAMINAS HIERRO NEGRO' WHERE codigo = 'LAM0113009'; -- LAMINA HN 10,00 mm X 1,200 X 2,40 m
UPDATE productos SET precio_usd = 16, precio_2 = 14.5, stock_actual = 278, categoria = 'LAMINAS HIERRO PULIDO' WHERE codigo = 'LAM0213001'; -- LAMINA HP 0,45 mm X 1,20 X 2,40 m
UPDATE productos SET precio_usd = 9.95, precio_2 = 8, stock_actual = 1443, categoria = 'LAMINAS HIERRO PULIDO' WHERE codigo = 'LAM0213002'; -- LAMINA HP 0,70 mm X 1,20 m X 1,40 m PROMOCION
UPDATE productos SET precio_usd = 32.55, precio_2 = 25, stock_actual = 27, categoria = 'LAMINAS HIERRO PULIDO' WHERE codigo = 'LAM0213003'; -- LAMINA HP 0,90 mm X 1,20 X 2,40 m
UPDATE productos SET precio_usd = 24.8, precio_2 = 23, stock_actual = 73, categoria = 'LAMINAS HIERRO PULIDO' WHERE codigo = 'LAM0213004'; -- LAMINA HP 0,90 mm X 1,23 X 2,00 m
UPDATE productos SET precio_usd = 21.95, precio_2 = 18, stock_actual = 134, categoria = 'LAMINAS HIERRO PULIDO' WHERE codigo = 'LAM0213006'; -- LAMINA HP 1,50 mm X 1,20 X 1,40 m
UPDATE productos SET precio_usd = 63, precio_2 = 59, stock_actual = 10, categoria = 'LAMINAS ESTRIADA' WHERE codigo = 'LAM0114001'; -- LAMINA EST. 2,50 mm X 1010 X 2,40 m
UPDATE productos SET precio_usd = 97, precio_2 = NULL, stock_actual = 41, categoria = 'LAMINAS ESTRIADA' WHERE codigo = 'LAM0114003'; -- LAMINA EST. 3,00 mm X 1000 X 2,40 m
UPDATE productos SET precio_usd = 129, precio_2 = NULL, stock_actual = 5, categoria = 'LAMINAS ESTRIADA' WHERE codigo = 'LAM0114002'; -- LAMINA EST. 5,00 mm X 1010 X 2,20 m
UPDATE productos SET precio_usd = 14.95, precio_2 = NULL, stock_actual = 123, categoria = 'LAMINAS GALVANIZADA' WHERE codigo = 'LAM0413001'; -- LAMINA GALV. LISA CAL. 26-0,40 mm X 1200 X 2,40 m
UPDATE productos SET precio_usd = 34.85, precio_2 = 32, stock_actual = 1, categoria = 'LAMINAS GALVANIZADA' WHERE codigo = 'LAM0413010'; -- LAMINA GALV. LISA CAL. 17-1,10 mm X 1200 X 2,40 m
UPDATE productos SET precio_usd = 47, precio_2 = 45, stock_actual = 12, categoria = 'LAMINAS GALVANIZADA' WHERE codigo = 'LAM0413009'; -- LAMINA GALV. LISA CAL. 17-1,50 mm X 1200 X 2,40 m
UPDATE productos SET precio_usd = 58.65, precio_2 = 56, stock_actual = 4, categoria = 'LAMINAS GALVANIZADA' WHERE codigo = 'LAM0413011'; -- LAMINA GALV. LISA CAL. 17-1,90 mm X 1200 X 2,40 m
UPDATE productos SET precio_usd = 90, precio_2 = NULL, stock_actual = 7, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1255001'; -- LAMINA TERMOPANEL SOLAR 3,70 X 1,04 mts
UPDATE productos SET precio_usd = 90, precio_2 = NULL, stock_actual = 1, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1255002'; -- LAMINA TERMOPANEL SOLAR 4,05 X 1,04 mts
UPDATE productos SET precio_usd = 198, precio_2 = NULL, stock_actual = 29, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1255003'; -- LAMINA TERMOPANEL SOLAR 4,20 X 1,04 mts
UPDATE productos SET precio_usd = 100, precio_2 = NULL, stock_actual = 1, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1255004'; -- LAMINA TERMOPANEL SOLAR 4,90 X 1,02 mts
UPDATE productos SET precio_usd = 150, precio_2 = NULL, stock_actual = 1, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1255005'; -- LAMINA TERMOPANEL SOLAR 5,90 X 1,04 mts
UPDATE productos SET precio_usd = 150, precio_2 = NULL, stock_actual = 7, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1255006'; -- LAMINA TERMOPANEL SOLAR 7,90 X 1,04 mts
UPDATE productos SET precio_usd = 59.5, precio_2 = NULL, stock_actual = 168, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1915006'; -- LOSACERO 6,10 X 0,80 mts CAL 20
UPDATE productos SET precio_usd = 49.5, precio_2 = NULL, stock_actual = 0, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1915001'; -- LOSACERO 6,10 X 0,79 mts CAL 22
UPDATE productos SET precio_usd = 43.2, precio_2 = NULL, stock_actual = 52, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1915003'; -- LOSACERO 6,10 X 0,60 mts CAL 24
UPDATE productos SET precio_usd = 44.95, precio_2 = NULL, stock_actual = 37, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1915004'; -- LOSACERO 6,10 X 0,65 mts CAL 24
UPDATE productos SET precio_usd = 46.95, precio_2 = NULL, stock_actual = 84, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1915002'; -- LOSACERO 6,10 X 0,80 mts CAL 24
UPDATE productos SET precio_usd = 40.8, precio_2 = NULL, stock_actual = 6, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1915005'; -- LOSACERO 6,10 X 0,75 mts CAL 26
UPDATE productos SET precio_usd = 6.5, precio_2 = NULL, stock_actual = 631, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM0413003'; -- LAMINA ZINC GALV. 0,17 X 0.80 X 3,66 m
UPDATE productos SET precio_usd = 7.16, precio_2 = NULL, stock_actual = 26, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1916001'; -- LAM. PREPINTADO ROJO (ZINC) 0,15 X 800 X 3,00 MTS
UPDATE productos SET precio_usd = 8.62, precio_2 = NULL, stock_actual = 78, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1916002'; -- LAM. PREPINTADO ROJO (ZINC) 0,15 X 800 X 3,60 MTS
UPDATE productos SET precio_usd = 16.53, precio_2 = NULL, stock_actual = 31, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1916005'; -- LAMINA PR1 PREPINTADO ROJO 0,27 X 1050 X 3,00 mts
UPDATE productos SET precio_usd = 19.92, precio_2 = NULL, stock_actual = 15, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1916006'; -- LAMINA PR1 PREPINTADO ROJO 0,27 X 1050 X 3,60 mts
UPDATE productos SET precio_usd = 55, precio_2 = NULL, stock_actual = 2, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1954001'; -- LAMINA GALVATECHO 5,80 X 0,90 mts
UPDATE productos SET precio_usd = 27.5, precio_2 = 25, stock_actual = 1, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1954003'; -- LAMINA ARQUITECTONICA AZUL 6 mts x 1,08 x 0,25 cal
UPDATE productos SET precio_usd = 27.5, precio_2 = 25, stock_actual = 5, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1954004'; -- LAMINA ARQUITECTONICA ROJA 6 mts x 1,08 x 0,25 cal
UPDATE productos SET precio_usd = 35, precio_2 = 33.65, stock_actual = 65, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1954006'; -- LAMINA ARQUITECTONICA AZUL 6 mts x 1,08 x 0,35 cal
UPDATE productos SET precio_usd = 35, precio_2 = 33.65, stock_actual = 1, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1954007'; -- LAMINA ARQUITECTONICA BLANCA 6 mts x 1,08 x 0,35 cal
UPDATE productos SET precio_usd = 35, precio_2 = 33.65, stock_actual = 4, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1954005'; -- LAMINA ARQUITECTONICA NARANJA 6 mts x 1,08 x 0,35 cal
UPDATE productos SET precio_usd = 48, precio_2 = NULL, stock_actual = 4, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1955007'; -- LAMINA TIPO PVC MIL TEJAS TRANSPARENTE 6,60 X 1,04 mts
UPDATE productos SET precio_usd = 17, precio_2 = 12, stock_actual = 480, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1955005'; -- CABALLETE CUMBRERA 0,70 X 2,00 mts
UPDATE productos SET precio_usd = 5, precio_2 = 3, stock_actual = 600, categoria = 'LAMINAS DE TECHO' WHERE codigo = 'LAM1954002'; -- REMATE PARA FACHADA 0,20 X 2,00 mts
UPDATE productos SET precio_usd = 57.6, precio_2 = NULL, stock_actual = 200, categoria = 'LAMINAS OTRAS' WHERE codigo = 'LAM1115001'; -- LAMINA MIL TEJAS 2,00 X 1,05 M X 5,70 M
UPDATE productos SET precio_usd = 295, precio_2 = NULL, stock_actual = 34, categoria = 'MALLAS' WHERE codigo = 'MAL0138001'; -- MALLA TRUCKSON 5 X 5 X 120 mts
UPDATE productos SET precio_usd = 136, precio_2 = NULL, stock_actual = 147, categoria = 'MALLAS' WHERE codigo = 'MAL0138002'; -- MALLA TRUCKSON 6 X 6 X 100 mts
UPDATE productos SET precio_usd = 190, precio_2 = NULL, stock_actual = 1, categoria = 'VIGAS WF' WHERE codigo = 'VIG0110001'; -- VIGA WF 10X17 TIPO IPE 260 X 100 X 5,92 mts C/FLANCHE12X22cmX16mm
UPDATE productos SET precio_usd = 270, precio_2 = NULL, stock_actual = 147, categoria = 'VIGAS WF' WHERE codigo = 'VIG0110002'; -- VIGA WF 12X19 TIPO IPE 300 X 100 X 6,00 mts
UPDATE productos SET precio_usd = 280, precio_2 = NULL, stock_actual = 32, categoria = 'VIGAS WF' WHERE codigo = 'VIG0110003'; -- VIGA WF 12X22 TIPO IPE 300 X 105 X 6,00 mts
UPDATE productos SET precio_usd = 290, precio_2 = NULL, stock_actual = 34, categoria = 'VIGAS WF' WHERE codigo = 'VIG0110004'; -- VIGA WF 12X26 TIPO IPE 300 X 165 X 6,18 mts C/FLANCHE45X17cmX16mm
UPDATE productos SET precio_usd = 7.5, precio_2 = NULL, stock_actual = 24, categoria = 'ZUNCHO' WHERE codigo = 'ZUN0140004'; -- ZUNCHO 12 X 15 X 5,20 mm (Paquete 20 und)
UPDATE productos SET precio_usd = 7.9, precio_2 = NULL, stock_actual = 22, categoria = 'ZUNCHO' WHERE codigo = 'ZUN0140005'; -- ZUNCHO 15 X 15 X 5,20 mm (Paquete 20 und)
UPDATE productos SET precio_usd = 9, precio_2 = 8, stock_actual = 165, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111001'; -- ANGULO 20 X 3mm X 6,00 mts
UPDATE productos SET precio_usd = 9.67, precio_2 = NULL, stock_actual = 53, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111008'; -- ANGULO 25 X 3mm X 6,00 mts
UPDATE productos SET precio_usd = 9.98, precio_2 = NULL, stock_actual = 260, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111012'; -- ANGULO 30 X 2,5mm X 6,00 mts
UPDATE productos SET precio_usd = 15.96, precio_2 = NULL, stock_actual = 79, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111009'; -- ANGULO 40 X 3mm X 6,00 mts *
UPDATE productos SET precio_usd = 21, precio_2 = NULL, stock_actual = 106, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111002'; -- ANGULO 40 X 4mm X 6,00 mts *
UPDATE productos SET precio_usd = 30.38, precio_2 = NULL, stock_actual = 4, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111003'; -- ANGULO 50 X 4mm X 6,00 mts *
UPDATE productos SET precio_usd = 106.22, precio_2 = NULL, stock_actual = 105, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111011'; -- ANGULO 75 X 7mm X 12,00 mts
UPDATE productos SET precio_usd = 72.88, precio_2 = NULL, stock_actual = 1, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111010'; -- ANGULO 75 X 8mm X 6,00 mts
UPDATE productos SET precio_usd = 129, precio_2 = NULL, stock_actual = 23, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0111006'; -- ANGULO 75 X 8mm X 12,00 mts
UPDATE productos SET precio_usd = 7.01, precio_2 = NULL, stock_actual = 152, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0112003'; -- PLETINA 1 X 1/8 X 6,00 mts
UPDATE productos SET precio_usd = 9.9, precio_2 = NULL, stock_actual = 278, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0112006'; -- PLETINA 1 X 1/4 X 6,00 mts
UPDATE productos SET precio_usd = 14.19, precio_2 = NULL, stock_actual = 13, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0112002'; -- PLETINA 1 1/2 X 3/16 x 6,00 mts
UPDATE productos SET precio_usd = 14.01, precio_2 = NULL, stock_actual = 98, categoria = 'PERFILES ANGULOS' WHERE codigo = 'PER0112005'; -- PLETINA 2 X 1/8 X 6,00 mts
UPDATE productos SET precio_usd = 275, precio_2 = NULL, stock_actual = 21, categoria = 'PORTONES Y PERFILES' WHERE codigo = 'PER0101001'; -- PORTONES DECORATIVOS 2,58 X 2,52 mts
UPDATE productos SET precio_usd = 12, precio_2 = NULL, stock_actual = 606, categoria = 'PORTONES Y PERFILES' WHERE codigo = 'PER0143001'; -- PERFIL PARA MARCOS DE PUERTAS 10 X 5,80 mts
UPDATE productos SET precio_usd = 25.62, precio_2 = NULL, stock_actual = 93, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301009'; -- TUBO ESTRUC. CUAD. 40 X 40 X 2,50mm X 6,00 mts
UPDATE productos SET precio_usd = 31, precio_2 = NULL, stock_actual = 23, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301010'; -- TUBO ESTRUC. CUAD. 50 X 50 X 2,50mm X 6,00 mts
UPDATE productos SET precio_usd = 43.5, precio_2 = NULL, stock_actual = 17, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301011'; -- TUBO ESTRUC. CUAD. 60 X 60 X 2,5mm X 6,00 mts
UPDATE productos SET precio_usd = 48.58, precio_2 = NULL, stock_actual = 3, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301012'; -- TUBO ESTRUC. CUAD. 70 X 70 X 2,5mm X 6,00 mts
UPDATE productos SET precio_usd = 39, precio_2 = NULL, stock_actual = 19, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301013'; -- TUBO ESTRUC. CUAD. 90 X 90 X 2,00mm X 6,00 mts
UPDATE productos SET precio_usd = 35, precio_2 = NULL, stock_actual = 13, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301014'; -- TUBO ESTRUC. CUAD. 90 X 90 X 3,2mm X 3,90 mts 2da
UPDATE productos SET precio_usd = 43, precio_2 = NULL, stock_actual = 57, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301015'; -- TUBO ESTRUC. CUAD. 90 X 90 X 3,2mm X 4,85 mts 2da
UPDATE productos SET precio_usd = 36, precio_2 = NULL, stock_actual = 75, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301020'; -- TUBO ESTRUC. CUAD. 100 X 100 X 1,50mm X 6,00 mts
UPDATE productos SET precio_usd = 139, precio_2 = NULL, stock_actual = 35, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301021'; -- TUBO ESTRUC. CUAD. 100 X 100 X 3,5mm X 12,00 mts
UPDATE productos SET precio_usd = 275, precio_2 = NULL, stock_actual = 5, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301018'; -- TUBO ESTRUC. CUAD. 120 X 120 X 4,00 mm X 12,00 mts
UPDATE productos SET precio_usd = 285, precio_2 = NULL, stock_actual = 20, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301022'; -- TUBO ESTRUC. CUAD. 120 X 120 X 4,50 mm X 12,00 mts
UPDATE productos SET precio_usd = 26.78, precio_2 = NULL, stock_actual = 131, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301005'; -- TUBO ESTRUC. CUAD. 125 X 125 X 4,00mm X 2,06 mts 2da
UPDATE productos SET precio_usd = 28.6, precio_2 = NULL, stock_actual = 107, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301006'; -- TUBO ESTRUC. CUAD. 125 X 125 X 4,00mm X 2,20 mts 2da
UPDATE productos SET precio_usd = 33.8, precio_2 = NULL, stock_actual = 4, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301007'; -- TUBO ESTRUC. CUAD. 125 X 125 X 4,00mm X 2,60 mts 2da
UPDATE productos SET precio_usd = 402.41, precio_2 = NULL, stock_actual = 9, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301023'; -- TUBO ESTRUC. CUAD. 155 X 155 X 4,20mm X 12,00 mts
UPDATE productos SET precio_usd = 470, precio_2 = NULL, stock_actual = 3, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0301008'; -- TUBO ESTRUC. CUAD. 200 X 200 X 5,00mm X 12,00 mts
UPDATE productos SET precio_usd = 30, precio_2 = 29, stock_actual = 214, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302005'; -- TUBO ESTRUC. RECT. 80 X 40 X 2,00mm X 6,00 mts
UPDATE productos SET precio_usd = 78, precio_2 = NULL, stock_actual = 42, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302010'; -- TUBO ESTRUC. RECT. 80 X 40 X 2,50mm X 12,00 mts
UPDATE productos SET precio_usd = 44, precio_2 = NULL, stock_actual = 73, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302001'; -- TUBO ESTRUC. RECT. 100 X 40 X 2,00mm X 6,00 mts
UPDATE productos SET precio_usd = 92.37, precio_2 = NULL, stock_actual = 96, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302007'; -- TUBO ESTRUC. RECT. 100 X 40 X 2,50mm X 12,00 mts
UPDATE productos SET precio_usd = 56, precio_2 = 45, stock_actual = 88, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302002'; -- TUBO ESTRUC. RECT. 120 X 60 X 2,5mm X 6,00 mts
UPDATE productos SET precio_usd = 117.7, precio_2 = NULL, stock_actual = 7, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302008'; -- TUBO ESTRUC. RECT. 120 X 60 X 2,5mm X 12,00 mts
UPDATE productos SET precio_usd = 19, precio_2 = NULL, stock_actual = 1110, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0339001'; -- TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 2,60 mts 2da
UPDATE productos SET precio_usd = 23, precio_2 = NULL, stock_actual = 77, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0339002'; -- TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 3,00 mts 2da
UPDATE productos SET precio_usd = 36, precio_2 = NULL, stock_actual = 144, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0339003'; -- TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 4,60 mts 2da
UPDATE productos SET precio_usd = 39, precio_2 = NULL, stock_actual = 31, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0339004'; -- TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 4,80 mts 2da
UPDATE productos SET precio_usd = 48, precio_2 = 44, stock_actual = 110, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0339005'; -- TUBO ESTRUC. RECT. 120 X 60 X 3,00mm X 6,00 mts 2da Sold
UPDATE productos SET precio_usd = 68.58, precio_2 = NULL, stock_actual = 18, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302006'; -- TUBO ESTRUC. RECT. 140 X 60 X 2,50mm X 6,00 mts
UPDATE productos SET precio_usd = 210, precio_2 = NULL, stock_actual = 18, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302003'; -- TUBO ESTRUC. RECT. 160 X 65 X 3,00mm X 12,00 mts
UPDATE productos SET precio_usd = 244.95, precio_2 = NULL, stock_actual = 24, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302009'; -- TUBO ESTRUC. RECT. 200 X 70 X 3,00mm X 12,00 mts
UPDATE productos SET precio_usd = 170, precio_2 = NULL, stock_actual = 2, categoria = 'TUBOS ESTRUCTURALES' WHERE codigo = 'TUB0302004'; -- TUBO ESTRUC. RECT. 220 X 90 X 5,00mm X 6,00 mts
UPDATE productos SET precio_usd = 3.01, precio_2 = NULL, stock_actual = 138, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201003'; -- TUBO PULIDO CUAD. 1/2 X 1/2 X 0,90 mm X 6,00 mts
UPDATE productos SET precio_usd = 4.62, precio_2 = NULL, stock_actual = 3, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201009'; -- TUBO PULIDO CUAD. 3/4 X 3/4 X 0,80 mm X 6,00 mts
UPDATE productos SET precio_usd = 6.84, precio_2 = NULL, stock_actual = 79, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201005'; -- TUBO PULIDO CUAD. 1 X 1 X 0,90mm X 6,00 mts
UPDATE productos SET precio_usd = 12.07, precio_2 = NULL, stock_actual = 32, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201014'; -- TUBO PULIDO CUAD. 1 X 1 X 1,90mm X 6,00 mts
UPDATE productos SET precio_usd = 9.6, precio_2 = NULL, stock_actual = 50, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201001'; -- TUBO PULIDO CUAD. 1 1/2 X 1 1/2 X 0,80 mm X 6,00 mts
UPDATE productos SET precio_usd = 9.78, precio_2 = NULL, stock_actual = 165, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201002'; -- TUBO PULIDO CUAD. 1 1/2 X 1 1/2 X 0,90 mm X 6,00 mts
UPDATE productos SET precio_usd = 15.11, precio_2 = NULL, stock_actual = 62, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201013'; -- TUBO PULIDO CUAD. 1 1/2 X 1 1/2 X 1,50 mm X 6,00 mts
UPDATE productos SET precio_usd = 7.52, precio_2 = NULL, stock_actual = 70, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201012'; -- TUBO PULIDO CUAD. 1 1/4 X 1 1/4 X 0,90 mm X 6,00 mts
UPDATE productos SET precio_usd = 13.3, precio_2 = NULL, stock_actual = 98, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201011'; -- TUBO PULIDO CUAD. 2 X 2 X 0,90 mm X 6,00 mts
UPDATE productos SET precio_usd = 14, precio_2 = NULL, stock_actual = 20, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201006'; -- TUBO PULIDO CUAD. 2 X 2 X 1,00 mm X 6,00 mts
UPDATE productos SET precio_usd = 19.35, precio_2 = NULL, stock_actual = 98, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201017'; -- TUBO PULIDO CUAD. 2 X 2 X 1,50 mm X 6,00 mts
UPDATE productos SET precio_usd = 22, precio_2 = NULL, stock_actual = 7, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201008'; -- TUBO PULIDO CUAD. 2 X 2 X 2,20 mm X 6,00 mts
UPDATE productos SET precio_usd = 32, precio_2 = NULL, stock_actual = 65, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0201010'; -- TUBO PULIDO CUAD. 4 X 4 X 1,40 mm X 6,00 mts 2da
UPDATE productos SET precio_usd = 6.87, precio_2 = NULL, stock_actual = 192, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202001'; -- TUBO PULIDO RECT. 1 1/2 X 1/2 X 0,90 X 6,00 mts
UPDATE productos SET precio_usd = 7.9, precio_2 = NULL, stock_actual = 360, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202004'; -- TUBO PULIDO RECT. 2 X 1 X 0,70 mm X 6,00 mts
UPDATE productos SET precio_usd = 8.7, precio_2 = NULL, stock_actual = 68, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202005'; -- TUBO PULIDO RECT. 2 X 1 X 0,90 mm X 6,00 mts
UPDATE productos SET precio_usd = 10.89, precio_2 = NULL, stock_actual = 86, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202014'; -- TUBO PULIDO RECT. 2 X 1 X 1,10 mm X 6,00 mts
UPDATE productos SET precio_usd = 13.4, precio_2 = NULL, stock_actual = 30, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202011'; -- TUBO PULIDO RECT. 3 X 1 X 0,90 mm X 6,00 mts
UPDATE productos SET precio_usd = 12.36, precio_2 = NULL, stock_actual = 1847, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202012'; -- TUBO PULIDO RECT. 3 X 1 X 1,30 mm X 6,00 mts OFERTA
UPDATE productos SET precio_usd = 25.16, precio_2 = NULL, stock_actual = 24, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202015'; -- TUBO PULIDO RECT. 3 X 1 X 1,90 mm X 6,00 mts
UPDATE productos SET precio_usd = 16.77, precio_2 = NULL, stock_actual = 66, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202008'; -- TUBO PULIDO RECT. 3 X 1 1/2 X 0,90 mm X 6,00 mts
UPDATE productos SET precio_usd = 14.9, precio_2 = NULL, stock_actual = 12, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0239001'; -- TUBO PULIDO RECT. 3 X 1 1/2 X 0,90 mm X 6,00 mts 2da
UPDATE productos SET precio_usd = 23, precio_2 = NULL, stock_actual = 50, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202010'; -- TUBO PULIDO RECT. 3 X 1 1/2 X 1.4 mm X 6,00 mts
UPDATE productos SET precio_usd = 23, precio_2 = NULL, stock_actual = 10, categoria = 'TUBOS PULIDO' WHERE codigo = 'TUB0202013'; -- TUBO PULIDO RECT. 3 X 1 1/2 X 1.5 mm X 6,00 mts
UPDATE productos SET precio_usd = 12, precio_2 = 9.95, stock_actual = 2199, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403001'; -- TUBO GALV. 1/2 X 2,3mm X 5,80 mts
UPDATE productos SET precio_usd = 8, precio_2 = NULL, stock_actual = 836, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403002'; -- TUBO GALV. 1" X 1,4mm X 3,00 mts EMT (ELECTRICO)
UPDATE productos SET precio_usd = 8.7, precio_2 = NULL, stock_actual = 33, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403009'; -- TUBO GALV. 1 1/4 X 6,60mts EMT PARA CERCA
UPDATE productos SET precio_usd = 17, precio_2 = 13.95, stock_actual = 2668, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403005'; -- TUBO GALV. C/ROSC. 1/2 X 2,3mm X 6,00 mts
UPDATE productos SET precio_usd = 26, precio_2 = 23.95, stock_actual = 118, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403007'; -- TUBO GALV. C/ROSC. 3/4 X 6,00 mts ISO 150
UPDATE productos SET precio_usd = 59, precio_2 = 35, stock_actual = 3, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403003'; -- TUBO GALV. C/ROSC. 1 1/2 x 4mm X 5,90 mts
UPDATE productos SET precio_usd = 65, precio_2 = 45, stock_actual = 3, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403004'; -- TUBO GALV. C/ROSC. 1 1/2 X 4mm X 6,40 mts
UPDATE productos SET precio_usd = 79, precio_2 = 60, stock_actual = 6, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403006'; -- TUBO GALV. C/ROSC. 2 1/4 X 4mm X 6,00 mts
UPDATE productos SET precio_usd = 79, precio_2 = NULL, stock_actual = 8, categoria = 'TUBOS GALVANIZADO' WHERE codigo = 'TUB0403008'; -- TUBO GALV. C/ROSC. 4" X 2mm X 3,00 mts
UPDATE productos SET precio_usd = 22.58, precio_2 = NULL, stock_actual = 55, categoria = 'TUBOS DE VENTILACION' WHERE codigo = 'TUB1403001'; -- TUBO VENT. 1 1/2 X 2,00mm X 6,00 mts
UPDATE productos SET precio_usd = 26, precio_2 = 19, stock_actual = 8, categoria = 'TUBOS DE VENTILACION' WHERE codigo = 'TUB1403002'; -- TUBO VENT. 1 1/2 X 2,60mm X 6,00 mts
UPDATE productos SET precio_usd = 13.65, precio_2 = NULL, stock_actual = 54, categoria = 'TUBOS DE VENTILACION' WHERE codigo = 'TUB1403008'; -- TUBO VENT. 1 X 2,00mm X 6,00 mts
UPDATE productos SET precio_usd = 37.8, precio_2 = NULL, stock_actual = 35, categoria = 'TUBOS DE VENTILACION' WHERE codigo = 'TUB1403004'; -- TUBO VENT. 2 X 2,50mm X 6,00 mst
UPDATE productos SET precio_usd = 60, precio_2 = NULL, stock_actual = 3, categoria = 'TUBOS DE VENTILACION' WHERE codigo = 'TUB1403006'; -- TUBO VENT. 3 1/2" X 2mm X 6,00 mts
UPDATE productos SET precio_usd = 2.9, precio_2 = 2.5, stock_actual = 3873, categoria = 'TUBOS PVC ELECTRICOS' WHERE codigo = 'TUB0903002'; -- TUBO ELEC. 1/2" X 3,00 mts
UPDATE productos SET precio_usd = 3.5, precio_2 = 2.9, stock_actual = 1255, categoria = 'TUBOS PVC ELECTRICOS' WHERE codigo = 'TUB0903003'; -- TUBO ELEC. 3/4" X 3,00 mts OCC PLAST
UPDATE productos SET precio_usd = 6.5, precio_2 = 5.2, stock_actual = 195, categoria = 'TUBOS PVC ELECTRICOS' WHERE codigo = 'TUB0903006'; -- TUBO ELEC. 1 1/2 X 3,00 mts
UPDATE productos SET precio_usd = 3.7, precio_2 = 4.5, stock_actual = 20, categoria = 'TUBOS PVC ELECTRICOS' WHERE codigo = 'TUB0903005'; -- TUBO ELEC. 1" X 3,00 mts TUBRICA
UPDATE productos SET precio_usd = 8.5, precio_2 = 6.9, stock_actual = 302, categoria = 'TUBOS PVC ELECTRICOS' WHERE codigo = 'TUB0903007'; -- TUBO ELEC. 2" X 3,00 mts UNITECA
UPDATE productos SET precio_usd = 37, precio_2 = NULL, stock_actual = 318, categoria = 'TUBOS PVC ELECTRICOS' WHERE codigo = 'TUB0903009'; -- TUBO ELEC. 4" 114,0mm X ESP. 3,55mm X 6,00 mts REFORZADO
UPDATE productos SET precio_usd = 3.95, precio_2 = 2.95, stock_actual = 922, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603002'; -- TUBO PVC A.F. 1/2 X 3,00 mts GRIS
UPDATE productos SET precio_usd = 7.9, precio_2 = 6.5, stock_actual = 797, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603003'; -- TUBO PVC A.F. 1/2 X 6,00 mts
UPDATE productos SET precio_usd = 8.9, precio_2 = 7.5, stock_actual = 521, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603009'; -- TUBO PVC A.F. 1/2 X 6,00 mts 9.500 PSI REFORZADO
UPDATE productos SET precio_usd = 9.5, precio_2 = 8.7, stock_actual = 184, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603007'; -- TUBO PVC A.F. 3/4 X 2,41mm X 6,00 mts ALTA PRESION *UNITECA *
UPDATE productos SET precio_usd = 7.3, precio_2 = NULL, stock_actual = 47, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603008'; -- TUBO PVC A.F. 1" X 6,00 mts NACIONAL
UPDATE productos SET precio_usd = 17, precio_2 = NULL, stock_actual = 298, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603001'; -- TUBO PVC A.F 1 1/2 X 6,00 mts
UPDATE productos SET precio_usd = 27, precio_2 = NULL, stock_actual = 154, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603012'; -- TUBO PVC A.F. 1 1/2 X 2,84mm PRS 250 PSI X 6,00 mts ASTM TUBRICA
UPDATE productos SET precio_usd = 23, precio_2 = NULL, stock_actual = 73, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603013'; -- TUBO PVC A.F. 1 1/2X 3,00mm PRESION 200 PSI X 6,00 mts *TUBRICA
UPDATE productos SET precio_usd = 23, precio_2 = NULL, stock_actual = 44, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603004'; -- TUBO PVC A.F. 2" X 6,00 mts
UPDATE productos SET precio_usd = 27, precio_2 = 21, stock_actual = 200, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603010'; -- TUBO PVC A.F. 2" X 6,00 mts IMPORTADO
UPDATE productos SET precio_usd = 37, precio_2 = NULL, stock_actual = 60, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603006'; -- TUBO PVC A.F. 2 1/2 X 3,48mm PRESION 200 PSI X 6,00 mts *TUBRICA
UPDATE productos SET precio_usd = 35, precio_2 = NULL, stock_actual = 93, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603011'; -- TUBO PVC A.F. 2 1/2"X 3,60mm PRS 150 PSI X 6,00 mts ACUEDUCTO CLASE AB
UPDATE productos SET precio_usd = 35, precio_2 = 27, stock_actual = 10, categoria = 'TUBOS PVC AGUA FRIA' WHERE codigo = 'TUB0603005'; -- TUBO PVC A.F 3 X 6,00 mts GRIS
UPDATE productos SET precio_usd = 8, precio_2 = 5.5, stock_actual = 875, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803002'; -- TUBO PVC A/N 2" X 1,8 mm x 3,00 mts PAVCO
UPDATE productos SET precio_usd = 7.5, precio_2 = 4.9, stock_actual = 66, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803003'; -- TUBO PVC A/N 2" X 1,8 mm x 3,00 mts SANALITE
UPDATE productos SET precio_usd = 8, precio_2 = 5.3, stock_actual = 124, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803004'; -- TUBO PVC A/N 2" X 1,8 mm X 3,00 mts TUBRICA
UPDATE productos SET precio_usd = 8, precio_2 = 5.4, stock_actual = 234, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803006'; -- TUBO PVC A/N 2" X 1,8 mm X 3,00 mts UNITECA
UPDATE productos SET precio_usd = 6, precio_2 = 4.6, stock_actual = 249, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803007'; -- TUBO PVC A/N 2" X 3,00 mts DERIVADOS PLASTICOS
UPDATE productos SET precio_usd = 6.5, precio_2 = 4.5, stock_actual = 491, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803008'; -- TUBO PVC A/N 2" X 3,00 mts OCC PLAST
UPDATE productos SET precio_usd = 13, precio_2 = 10.41, stock_actual = 5, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803005'; -- TUBO PVC A/N 2" X 3,9 mm X 3,00 mts PAVCO REFORZADO
UPDATE productos SET precio_usd = 8, precio_2 = 5.4, stock_actual = 10, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803011'; -- TUBO PVC A/N 3" X 3,00 mts IMP. CHARLLOTE PIPE
UPDATE productos SET precio_usd = 7.5, precio_2 = 5.4, stock_actual = 386, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803009'; -- TUBO PVC A/N 3" X 3,00 mts OCC PLAST
UPDATE productos SET precio_usd = 8, precio_2 = 5.9, stock_actual = 291, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803012'; -- TUBO PVC A/N 3" X 3,00 mts DERIVADOS PLASTICOS
UPDATE productos SET precio_usd = 16.9, precio_2 = NULL, stock_actual = 69, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803016'; -- TUBO PVC A/N 4" X 3,2mm X 3,00 mts REFORZADO (NEGRO)
UPDATE productos SET precio_usd = 35, precio_2 = 32, stock_actual = 385, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB0803014'; -- TUBO PVC A/N 6" X 3,00 mts OCC PLAST
UPDATE productos SET precio_usd = 52, precio_2 = 39, stock_actual = 20, categoria = 'TUBOS PVC AGUAS NEGRAS' WHERE codigo = 'TUB1503001'; -- TUBO PVC ALCANT. CORRUGADO 4" X 6,00 mts
UPDATE productos SET precio_usd = 787.4, precio_2 = 739, stock_actual = 20, categoria = 'VIGAS HE' WHERE codigo = 'VIG0156001'; -- VIGA HEA 200 X 200 X 12,00 mts
UPDATE productos SET precio_usd = 1490, precio_2 = NULL, stock_actual = 19, categoria = 'VIGAS HE' WHERE codigo = 'VIG0105001'; -- VIGA HEB 260 X 260 X 13,88 mts
UPDATE productos SET precio_usd = 1250, precio_2 = NULL, stock_actual = 5, categoria = 'VIGAS HE' WHERE codigo = 'VIG0105002'; -- VIGA HEB 400 X 6,50 mts
UPDATE productos SET precio_usd = 105.78, precio_2 = 104, stock_actual = 36, categoria = 'VIGAS IPE' WHERE codigo = 'VIG0106004'; -- VIGA IPE 80 X 12 mts
UPDATE productos SET precio_usd = 134.7, precio_2 = 129, stock_actual = 11, categoria = 'VIGAS IPE' WHERE codigo = 'VIG0106005'; -- VIGA IPE 100 X 12 mts
UPDATE productos SET precio_usd = 90, precio_2 = NULL, stock_actual = 70, categoria = 'VIGAS IPE' WHERE codigo = 'VIG0106001'; -- VIGA IPE 160 X 90 X 5,75 mts
UPDATE productos SET precio_usd = 190, precio_2 = NULL, stock_actual = 79, categoria = 'VIGAS IPE' WHERE codigo = 'VIG0106002'; -- VIGA IPE 250 X 130 X 5,75 mts
UPDATE productos SET precio_usd = 67.35, precio_2 = NULL, stock_actual = 1, categoria = 'VIGAS IPE' WHERE codigo = 'VIG0106006'; -- VIGA IPE 100 X 6 mts
UPDATE productos SET precio_usd = 28, precio_2 = NULL, stock_actual = 3, categoria = 'VIGAS IPN' WHERE codigo = 'VIG0107001'; -- VIGA IPN 100 X 2,04 mts
UPDATE productos SET precio_usd = 190.97, precio_2 = NULL, stock_actual = 55, categoria = 'VIGAS IPN' WHERE codigo = 'VIG0107002'; -- VIGA IPN 120 X 12,00 mts
UPDATE productos SET precio_usd = 30, precio_2 = NULL, stock_actual = 4, categoria = 'VIGAS IPN' WHERE codigo = 'VIG0107004'; -- VIGA IPN 140 X 4,00 mts
UPDATE productos SET precio_usd = 32, precio_2 = NULL, stock_actual = 4, categoria = 'VIGAS IPN' WHERE codigo = 'VIG0107005'; -- VIGA IPN 140 X 5,00 mts
UPDATE productos SET precio_usd = 580, precio_2 = NULL, stock_actual = 44, categoria = 'VIGAS IPN' WHERE codigo = 'VIG0107006'; -- VIGA IPN 240 X 12,00 mts
UPDATE productos SET precio_usd = 145.77, precio_2 = NULL, stock_actual = 31, categoria = 'VIGAS UPL' WHERE codigo = 'VIG0108001'; -- VIGA UPL 100 X 12 mts
UPDATE productos SET precio_usd = 140, precio_2 = NULL, stock_actual = 5, categoria = 'VIGAS VP' WHERE codigo = 'VIG0109001'; -- VIGA VP 350 X 4,10 mts
UPDATE productos SET precio_usd = 290, precio_2 = NULL, stock_actual = 9, categoria = 'VIGAS VP' WHERE codigo = 'VIG0109002'; -- VIGA VP 350 X 7,13,00 mts
UPDATE productos SET precio_usd = 240, precio_2 = NULL, stock_actual = 12, categoria = 'VIGAS VP' WHERE codigo = 'VIG0109003'; -- VIGA VP 400 X 4,90 mts
UPDATE productos SET precio_usd = 0.35, precio_2 = NULL, stock_actual = 3830, categoria = 'CONEXIONES' WHERE codigo = 'CON0920001'; -- ADAPTADOR TERM CONDUIT 1" TUBRICA
UPDATE productos SET precio_usd = 0.3, precio_2 = NULL, stock_actual = 8854, categoria = 'CONEXIONES' WHERE codigo = 'CON0621002'; -- ANILLO A.F 1/2
UPDATE productos SET precio_usd = 0.32, precio_2 = NULL, stock_actual = 3960, categoria = 'CONEXIONES' WHERE codigo = 'CON0621003'; -- ANILLO A.F 3/4
UPDATE productos SET precio_usd = 0.38, precio_2 = NULL, stock_actual = 987, categoria = 'CONEXIONES' WHERE codigo = 'CON0621001'; -- ANILLO A.F. 1"
UPDATE productos SET precio_usd = 0.98, precio_2 = NULL, stock_actual = 779, categoria = 'CONEXIONES' WHERE codigo = 'CON0821001'; -- ANILLO A.N 2" TUBRICA
UPDATE productos SET precio_usd = 1.45, precio_2 = NULL, stock_actual = 237, categoria = 'CONEXIONES' WHERE codigo = 'CON0821002'; -- ANILLO A.N 3"
UPDATE productos SET precio_usd = 3.5, precio_2 = NULL, stock_actual = 60, categoria = 'CONEXIONES' WHERE codigo = 'CON0421002'; -- ANILLO EMT 1"
UPDATE productos SET precio_usd = 0.5, precio_2 = NULL, stock_actual = 229, categoria = 'CONEXIONES' WHERE codigo = 'CON0622001'; -- CODO A.F 1/2 X 45 NACIONAL
UPDATE productos SET precio_usd = 3.9, precio_2 = NULL, stock_actual = 685, categoria = 'CONEXIONES' WHERE codigo = 'CON0622003'; -- CODO A.F. 1 1/2 X 90 ALTA PRESION TUBRICA
UPDATE productos SET precio_usd = 1.35, precio_2 = NULL, stock_actual = 1624, categoria = 'CONEXIONES' WHERE codigo = 'CON0822001'; -- CODO A.N 2" X 45 TUBRICA
UPDATE productos SET precio_usd = 1.4, precio_2 = NULL, stock_actual = 42, categoria = 'CONEXIONES' WHERE codigo = 'CON0822002'; -- CODO A.N 2" X 90 BETAPLAST
UPDATE productos SET precio_usd = 1.9, precio_2 = 1.7, stock_actual = 31, categoria = 'CONEXIONES' WHERE codigo = 'CON0822003'; -- CODO A.N 2" X 90 IMPORTADO
UPDATE productos SET precio_usd = 1.9, precio_2 = 1.7, stock_actual = 75, categoria = 'CONEXIONES' WHERE codigo = 'CON0822004'; -- CODO A.N 2" X 90 TUBRICA
UPDATE productos SET precio_usd = 2.1, precio_2 = 1.85, stock_actual = 177, categoria = 'CONEXIONES' WHERE codigo = 'CON0822005'; -- CODO A.N 3" X 45 TUBRICA
UPDATE productos SET precio_usd = 2.1, precio_2 = 1.85, stock_actual = 345, categoria = 'CONEXIONES' WHERE codigo = 'CON0822006'; -- CODO A.N 3" X 90 NACIONAL
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.1, stock_actual = 6636, categoria = 'CONEXIONES' WHERE codigo = 'CON0822007'; -- CODO A.N 4" X 45 TUBRICA
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.4, stock_actual = 2717, categoria = 'CONEXIONES' WHERE codigo = 'CON0822008'; -- CODO A.N 4" X 90 TUBRICA
UPDATE productos SET precio_usd = 13, precio_2 = 9, stock_actual = 340, categoria = 'CONEXIONES' WHERE codigo = 'CON0822010'; -- CODO A.N 6" X 90 NACIONAL
UPDATE productos SET precio_usd = 0.8, precio_2 = 0.6, stock_actual = 295, categoria = 'CONEXIONES' WHERE codigo = 'CON0622002'; -- CODO CPVC 1/2 X 90 NACIONAL
UPDATE productos SET precio_usd = 1.5, precio_2 = 1.3, stock_actual = 49, categoria = 'CONEXIONES' WHERE codigo = 'CON0422001'; -- CODO HG 1" X 45
UPDATE productos SET precio_usd = 0.7, precio_2 = NULL, stock_actual = 6250, categoria = 'CONEXIONES' WHERE codigo = 'CON0923003'; -- CURVA CONDUIT 1/2 X 90"
UPDATE productos SET precio_usd = 1.45, precio_2 = NULL, stock_actual = 72, categoria = 'CONEXIONES' WHERE codigo = 'CON0923004'; -- CURVA CONDUIT 1/2" X 90 REFORZADO
UPDATE productos SET precio_usd = 0.99, precio_2 = 0.85, stock_actual = 15789, categoria = 'CONEXIONES' WHERE codigo = 'CON0923007'; -- CURVA CONDUIT 3/4" X 90 REFORZADO
UPDATE productos SET precio_usd = 1.2, precio_2 = 0.95, stock_actual = 741, categoria = 'CONEXIONES' WHERE codigo = 'CON0923002'; -- CURVA CONDUIT 1" X 90 REFORZADO
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.5, stock_actual = 1353, categoria = 'CONEXIONES' WHERE codigo = 'CON0923001'; -- CURVA CONDUIT 1 1/2" X 90 REFORZADO
UPDATE productos SET precio_usd = 5.5, precio_2 = 3.9, stock_actual = 88, categoria = 'CONEXIONES' WHERE codigo = 'CON0923005'; -- CURVA CONDUIT 2" X 90 NACIONAL
UPDATE productos SET precio_usd = 4.2, precio_2 = NULL, stock_actual = 808, categoria = 'CONEXIONES' WHERE codigo = 'CON0923006'; -- CURVA CONDUIT 2" X 90 REFORZADO
UPDATE productos SET precio_usd = 0.65, precio_2 = NULL, stock_actual = 995, categoria = 'CONEXIONES' WHERE codigo = 'CON0624002'; -- JUNTA DRESSER 1/2
UPDATE productos SET precio_usd = 0.85, precio_2 = NULL, stock_actual = 2569, categoria = 'CONEXIONES' WHERE codigo = 'CON0624001'; -- JUNTA DRESSER 3/4
UPDATE productos SET precio_usd = 1.6, precio_2 = 1.3, stock_actual = 237, categoria = 'CONEXIONES' WHERE codigo = 'CON0424001'; -- JUNTA DRESSER HG 1/2"
UPDATE productos SET precio_usd = 1.8, precio_2 = 1.5, stock_actual = 291, categoria = 'CONEXIONES' WHERE codigo = 'CON0424002'; -- JUNTA DRESSER HG 3/4"
UPDATE productos SET precio_usd = 0.65, precio_2 = NULL, stock_actual = 340, categoria = 'CONEXIONES' WHERE codigo = 'CON0425001'; -- NIPLE GALV 1/2 X 4 cm
UPDATE productos SET precio_usd = 0.75, precio_2 = NULL, stock_actual = 16, categoria = 'CONEXIONES' WHERE codigo = 'CON0425002'; -- NIPLE GALV 1/2 X 5 cm
UPDATE productos SET precio_usd = 0.85, precio_2 = NULL, stock_actual = 27, categoria = 'CONEXIONES' WHERE codigo = 'CON0425003'; -- NIPLE GALV 1/2 X 10 cm
UPDATE productos SET precio_usd = 2.8, precio_2 = 2.2, stock_actual = 66, categoria = 'CONEXIONES' WHERE codigo = 'CON0826001'; -- REDUCCION A.N 3 X 2
UPDATE productos SET precio_usd = 3, precio_2 = 2.6, stock_actual = 644, categoria = 'CONEXIONES' WHERE codigo = 'CON0826002'; -- REDUCCION A.N 4 X 2 TUBRICA
UPDATE productos SET precio_usd = 1.3, precio_2 = 1.09, stock_actual = 1974, categoria = 'CONEXIONES' WHERE codigo = 'CON0831001'; -- SIFON A.N 2" TUBRICA
UPDATE productos SET precio_usd = 2.9, precio_2 = 2.5, stock_actual = 485, categoria = 'CONEXIONES' WHERE codigo = 'CON0831002'; -- SIFON A.N 4" TUBRICA
UPDATE productos SET precio_usd = 0.72, precio_2 = NULL, stock_actual = 76, categoria = 'CONEXIONES' WHERE codigo = 'CON0427001'; -- TAPON GALV 1/2 MACHO
UPDATE productos SET precio_usd = 0.73, precio_2 = NULL, stock_actual = 739, categoria = 'CONEXIONES' WHERE codigo = 'CON0427002'; -- TAPON GALV 1/2 ROSC
UPDATE productos SET precio_usd = 1.8, precio_2 = 1.25, stock_actual = 2264, categoria = 'CONEXIONES' WHERE codigo = 'CON0828001'; -- TEE A.N 2" TUBRICA
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.9, stock_actual = 851, categoria = 'CONEXIONES' WHERE codigo = 'CON0828002'; -- TEE A.N 4" TUBRICA
UPDATE productos SET precio_usd = 0.45, precio_2 = 0.35, stock_actual = 356, categoria = 'CONEXIONES' WHERE codigo = 'CON0628001'; -- TEE A.F 1/2 LISA
UPDATE productos SET precio_usd = 0.35, precio_2 = NULL, stock_actual = 31, categoria = 'CONEXIONES' WHERE codigo = 'CON0628002'; -- TEE A.F 1/2 ROSC
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.5, stock_actual = 26, categoria = 'CONEXIONES' WHERE codigo = 'CON0828004'; -- TEE RED A.N 4 X 2 TUBRICA
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.2, stock_actual = 275, categoria = 'CONEXIONES' WHERE codigo = 'CON0828003'; -- TEE RED A.N 4 X 3 TUBRICA
UPDATE productos SET precio_usd = 13, precio_2 = 8.9, stock_actual = 75, categoria = 'CONEXIONES' WHERE codigo = 'CON0828005'; -- TEE RED A.N 6 X 4 TUBRICA
UPDATE productos SET precio_usd = 0.3, precio_2 = 0.18, stock_actual = 4293, categoria = 'CONEXIONES' WHERE codigo = 'CON0629001'; -- UNION CPVC A.C 1/2
UPDATE productos SET precio_usd = 0.6, precio_2 = 0.12, stock_actual = 2587, categoria = 'CONEXIONES' WHERE codigo = 'CON0929008'; -- UNION CONDUIT 1"
UPDATE productos SET precio_usd = 0.8, precio_2 = 0.22, stock_actual = 624, categoria = 'CONEXIONES' WHERE codigo = 'CON0429001'; -- UNION EMT 1"
UPDATE productos SET precio_usd = 1.3, precio_2 = 1.04, stock_actual = 3756, categoria = 'CONEXIONES' WHERE codigo = 'CON0629003'; -- UNION LISA A.F. 1/2" TUBRICA
UPDATE productos SET precio_usd = 0.6, precio_2 = 0.45, stock_actual = 2392, categoria = 'CONEXIONES' WHERE codigo = 'CON0629004'; -- UNION LISA A.F. 1/2" UNIVERSAL
UPDATE productos SET precio_usd = 0.6, precio_2 = 0.45, stock_actual = 500, categoria = 'CONEXIONES' WHERE codigo = 'CON0629002'; -- UNION LISA A.F. 3/4" TUBRICA
UPDATE productos SET precio_usd = 5.5, precio_2 = 4.5, stock_actual = 964, categoria = 'CONEXIONES' WHERE codigo = 'CON0830002'; -- YEE A.N 4" TUBRICA
UPDATE productos SET precio_usd = 12, precio_2 = 9.5, stock_actual = 143, categoria = 'CONEXIONES' WHERE codigo = 'CON0830003'; -- YEE A.N 6" NACIONAL
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.5, stock_actual = 6820, categoria = 'CONEXIONES' WHERE codigo = 'CON0830005'; -- YEE RED A.N 4" X 2 TUBRICA
UPDATE productos SET precio_usd = 4.5, precio_2 = 4, stock_actual = 132, categoria = 'CONEXIONES' WHERE codigo = 'CON0830004'; -- YEE RED A.N 4" X 3 TUBRICA
UPDATE productos SET precio_usd = 9.5, precio_2 = NULL, stock_actual = 260, categoria = 'CONEXIONES' WHERE codigo = 'CON0830001'; -- YEE RED A.N 6" X 4 TUBRICA
UPDATE productos SET precio_usd = 7.5, precio_2 = NULL, stock_actual = 2343, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE1603001'; -- ARVIDAL 1/0
UPDATE productos SET precio_usd = 7.5, precio_2 = NULL, stock_actual = 4082, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE1603002'; -- ARVIDAL 2/0
UPDATE productos SET precio_usd = 6.9, precio_2 = NULL, stock_actual = 1223, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE1848001'; -- BREAKER QO EMPOTRABLE 1 X 20 AMP
UPDATE productos SET precio_usd = 7.6, precio_2 = NULL, stock_actual = 15, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE1847001'; -- BREAKER QO SUPERFICIAL 1 X 20 AMP
UPDATE productos SET precio_usd = 9.9, precio_2 = NULL, stock_actual = 652, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE1848002'; -- BREAKER THQC EMPOTRABLE 2 X 60 AMP
UPDATE productos SET precio_usd = 17, precio_2 = NULL, stock_actual = 1261, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0433001'; -- CAJA DE MEDIDOR 40 X 30 X 20
UPDATE productos SET precio_usd = 14, precio_2 = NULL, stock_actual = 198, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0433002'; -- CAJA DE PASO ELECTRICA 6 X 6 X 6 GALV
UPDATE productos SET precio_usd = 11, precio_2 = NULL, stock_actual = 200, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0933001'; -- CAJA DE PASO ELECTRICA 8 X 8 X 8 PVC
UPDATE productos SET precio_usd = 0.9, precio_2 = NULL, stock_actual = 15281, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0433003'; -- CAJETIN 4 X 2 RECTANGULAR EMT
UPDATE productos SET precio_usd = 1.3, precio_2 = NULL, stock_actual = 236, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0433004'; -- CAJETIN 4 X 4 CUADRADO EMT
UPDATE productos SET precio_usd = 0.45, precio_2 = NULL, stock_actual = 2000, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0933002'; -- CAJETIN 4 X 4 CUADRADO PVC
UPDATE productos SET precio_usd = 1.3, precio_2 = NULL, stock_actual = 2009, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0433005'; -- CAJETIN 4 X 4 OCTAGONAL EMT
UPDATE productos SET precio_usd = 0.45, precio_2 = NULL, stock_actual = 2000, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0933003'; -- CAJETIN 4 X 4 OCTAGONAL PVC
UPDATE productos SET precio_usd = 170, precio_2 = NULL, stock_actual = 90, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0434006'; -- TABLERO 20 CIRCUITOS
UPDATE productos SET precio_usd = 70, precio_2 = NULL, stock_actual = 20, categoria = 'ELECTRICIDAD' WHERE codigo = 'ELE0434007'; -- TAPA PARA TABLERO 20 CIRCUITOS
UPDATE productos SET precio_usd = 2.8, precio_2 = NULL, stock_actual = 2500, categoria = 'FERRETERIA' WHERE codigo = 'FER0137004'; -- TOR A325 HEX GALV CALIENTE NC 5/8 X 2" 200 Grs.
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.2, stock_actual = 5000, categoria = 'FERRETERIA' WHERE codigo = 'FER0137003'; -- TOR A325 HEX GALV CALIENTE NC 5/8 X 2 1/2 300 Grs.
UPDATE productos SET precio_usd = 6.2, precio_2 = 4.06, stock_actual = 5003, categoria = 'FERRETERIA' WHERE codigo = 'FER0137001'; -- TOR A325 HEX GALV CALIENTE NC 1" x 3 1/2 600 Grs.
UPDATE productos SET precio_usd = 7.9, precio_2 = 4.7, stock_actual = 17114, categoria = 'FERRETERIA' WHERE codigo = 'FER0137002'; -- TOR A325 HEX GALV CALIENTE NC 1" X 4" 700 Grs.
UPDATE productos SET precio_usd = 0.7, precio_2 = 0.58, stock_actual = 400, categoria = 'FERRETERIA' WHERE codigo = 'FER0137006'; -- TOR C. HEX 5/8 X 3"
UPDATE productos SET precio_usd = 0.45, precio_2 = 0.31, stock_actual = 1591, categoria = 'FERRETERIA' WHERE codigo = 'FER0137005'; -- TOR C. HEX 1/2 X 2 1/2
UPDATE productos SET precio_usd = 7.3, precio_2 = NULL, stock_actual = 55, categoria = 'FERRETERIA' WHERE codigo = 'FER0142002'; -- CLAVO FERROSO 1"
UPDATE productos SET precio_usd = 9.7, precio_2 = NULL, stock_actual = 94, categoria = 'FERRETERIA' WHERE codigo = 'FER0142001'; -- CLAVO ACERO 2"
UPDATE productos SET precio_usd = 3.5, precio_2 = 2.9, stock_actual = 2994, categoria = 'FERRETERIA' WHERE codigo = 'FER1652001'; -- REJILLA A.N 2" ALUMINIO
UPDATE productos SET precio_usd = 2.5, precio_2 = 1.9, stock_actual = 461, categoria = 'FERRETERIA' WHERE codigo = 'FER0852001'; -- REJILLA A.N 4" PVC
UPDATE productos SET precio_usd = 4.5, precio_2 = 3.4, stock_actual = 173, categoria = 'FERRETERIA' WHERE codigo = 'FER2152001'; -- REJILLA A.N 4" BRONCE
UPDATE productos SET precio_usd = 0.74, precio_2 = NULL, stock_actual = 39, categoria = 'FERRETERIA' WHERE codigo = 'FER1003001'; -- DISCO DE CORTE 4 1/2
UPDATE productos SET precio_usd = 1.35, precio_2 = NULL, stock_actual = 6, categoria = 'FERRETERIA' WHERE codigo = 'FER1003002'; -- DISCO DE CORTE 7" X 1/16
UPDATE productos SET precio_usd = 1.26, precio_2 = NULL, stock_actual = 24, categoria = 'FERRETERIA' WHERE codigo = 'FER1003003'; -- DISCO DE ESMERILAR 4 1/2
UPDATE productos SET precio_usd = 2.94, precio_2 = NULL, stock_actual = 23, categoria = 'FERRETERIA' WHERE codigo = 'FER1003004'; -- DISCO DE ESMERILAR 7" X 1/16
UPDATE productos SET precio_usd = 5.46, precio_2 = NULL, stock_actual = 27, categoria = 'FERRETERIA' WHERE codigo = 'FER1003005'; -- DISCO DE TRONZADORA 14"
UPDATE productos SET precio_usd = 18, precio_2 = NULL, stock_actual = 267, categoria = 'FERRETERIA' WHERE codigo = 'FER1050001'; -- ARNES ANTI-CAIDAS
UPDATE productos SET precio_usd = 2.5, precio_2 = NULL, stock_actual = 4234, categoria = 'FERRETERIA' WHERE codigo = 'FER1051003'; -- ELECTRODO 6013 1/8 KEEP DRY
UPDATE productos SET precio_usd = 3.9, precio_2 = NULL, stock_actual = 71, categoria = 'FERRETERIA' WHERE codigo = 'FER1051001'; -- ELECTRODO 7018 1/8 GRICON
UPDATE productos SET precio_usd = 3.5, precio_2 = NULL, stock_actual = 229, categoria = 'FERRETERIA' WHERE codigo = 'FER1051002'; -- ELECTRODO 532 7 1/8 GRICON
UPDATE productos SET precio_usd = 25, precio_2 = NULL, stock_actual = 34, categoria = 'FERRETERIA' WHERE codigo = 'FER2052001'; -- PEGA PROF. PARA PVC DE ALTA PRESION ERA G-GOOD 946 ML A.C
UPDATE productos SET precio_usd = 120, precio_2 = NULL, stock_actual = 50, categoria = 'FERRETERIA' WHERE codigo = 'FER2249002'; -- KIT DE FREGADERO (1 FREGADERO DOBLE, 1 BAJANTE DOBLE, 2 DESAGUE, 2 LLAVE ARRESTO, 5 SARGENTO PEQ 1 GRIFERIA)

COMMIT;

-- Total de productos procesados: 302