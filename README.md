# Publicador de blogs · Myselec

Aplicación chica para que marketing cree **borradores** de blog en el WordPress de myselec.com.ar. Nunca publica: otra persona revisa y publica desde WordPress. Es independiente del CRM (otra base, otros usuarios, otras claves).

## Cómo correrlo

```bash
npm install
npm run build        # compila la pantalla y genera el cliente de Prisma
npm start            # http://localhost:3000
npm test             # pruebas
```

Para desarrollar la pantalla con recarga: `npm run dev` (servidor) y `npm run dev:client` (Vite, puerto 5173, reenvía `/api` al servidor).

## Variables

Los nombres están en `.env.example`. Los valores van en un `.env` local (ignorado por git) o en las variables de Railway. Nunca se escriben en el repositorio.

## Estado

Hechas: Fase 1 (base) y Fase 2 (usuarios, invitación, login, recuperación de contraseña, registro de ingresos). Falta: publicación en WordPress, pantallas y despliegue.


