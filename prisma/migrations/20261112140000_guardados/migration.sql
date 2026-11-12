-- CreateTable
CREATE TABLE "Guardado" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "categoryId" INTEGER,
    "authorId" TEXT,
    "html" TEXT NOT NULL DEFAULT '',
    "featured" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guardado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardadoImagen" (
    "id" TEXT NOT NULL,
    "guardadoId" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "datos" BYTEA NOT NULL,

    CONSTRAINT "GuardadoImagen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Guardado_userId_idx" ON "Guardado"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GuardadoImagen_guardadoId_posicion_key" ON "GuardadoImagen"("guardadoId", "posicion");

-- AddForeignKey
ALTER TABLE "Guardado" ADD CONSTRAINT "Guardado_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardadoImagen" ADD CONSTRAINT "GuardadoImagen_guardadoId_fkey" FOREIGN KEY ("guardadoId") REFERENCES "Guardado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

