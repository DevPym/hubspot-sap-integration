# Dockerfile — hubspot-sap-integration (Química Sur)
# Usa Node.js 22-alpine (imagen oficial, ligera, versión exacta controlada)
# Se usa en Railway en lugar de Nixpacks para garantizar la versión de Node.

# --- Etapa 1: Instalación de dependencias y build ---
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar archivos de dependencias primero (cache de Docker layers)
COPY package.json package-lock.json ./

# Instalar TODAS las dependencias (incluyendo devDependencies para tsc)
RUN npm ci

# Copiar código fuente
COPY . .

# Compilar TypeScript → JavaScript en /app/dist
RUN npm run build

# --- Etapa 2: Imagen de producción (solo lo necesario) ---
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./

# Instalar solo dependencias de producción (sin devDependencies)
RUN npm ci --omit=dev

# Copiar el código compilado desde la etapa de build
COPY --from=builder /app/dist ./dist

# Puerto que usa Express (Railway usa PORT=8080 por defecto)
EXPOSE 8080

# Ejecutar el servidor
CMD ["node", "dist/index.js"]
