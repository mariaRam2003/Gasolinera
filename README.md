# ⛽ Gasolinera — Sistema de Gestión

Aplicación web ligera para administrar las operaciones básicas de una gasolinera:

- Registrar ventas.
- Seleccionar combustible, forma de pago y cantidad.
- Calcular automáticamente quetzales ↔ galones.
- Consultar ventas del día.
- Administrar precios por galón.
- Proteger funciones administrativas con PIN.
- Generar cortes por fecha.
- Corregir/eliminar ventas desde el corte.
- Integración con Supabase mediante funciones RPC.

## Arquitectura

```text
gasolinera/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── api.js
│   ├── config.js              # NO se sube a Git
│   └── config.example.js
├── .gitignore
└── README.md
```

La aplicación utiliza JavaScript ES Modules y no necesita framework ni proceso de build.

## Configuración de Supabase

El frontend consume las siguientes funciones RPC que ya existen en tu proyecto:

- `get_prices`
- `today_sales`
- `add_sale`
- `admin_check`
- `admin_set_prices`
- `admin_change_pin`
- `admin_corte`
- `admin_delete_sale`

Copia:

```text
js/config.example.js
```

como:

```text
js/config.js
```

y completa:

```js
export const SUPABASE_URL = "https://TU-PROYECTO.supabase.co";
export const SUPABASE_KEY = "TU-PUBLISHABLE-O-ANON-KEY";
export const TIME_ZONE = "America/Guatemala";
```

### Seguridad

Esta aplicación es frontend, por lo que **no debes colocar una `service_role` key ni una secret key en ningún archivo que llegue al navegador**.

La Publishable/anon key está diseñada para aplicaciones frontend. La seguridad real debe estar en Supabase mediante RLS, permisos y las funciones RPC.

## Ejecutar localmente

Como utiliza ES Modules, no abras `index.html` directamente con `file://`.

Puedes usar VS Code + Live Server o cualquier servidor estático.

Ejemplo:

```bash
python -m http.server 5500
```

Después abre:

```text
http://localhost:5500
```

## GitHub

Antes de hacer commit:

```bash
git init
git add .
git commit -m "feat: initial gas station management app"
```

`js/config.js` está incluido en `.gitignore`, por lo que no se subirá.

> Nota: GitHub Pages no tendrá acceso a un archivo ignorado. Para un despliegue público automatizado, lo ideal es usar GitHub Actions para generar `config.js` durante el deploy, usando GitHub Secrets. También puedes usar otro mecanismo de configuración del hosting.

## Mejoras futuras

- Dashboard con ventas del día y semana.
- Exportación de cortes a PDF/Excel.
- Usuarios y roles en lugar de un PIN compartido.
- Historial de precios.
- Inventario de combustible.
- Registro de compras/abastecimientos.
- Reportes y gráficas.
- PWA para instalación en Android/iOS.
- Auditoría de modificaciones.
- Tests automatizados.
