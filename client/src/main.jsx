import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './estilos.css';

function App() {
  const [estado, setEstado] = useState('comprobando…');
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setEstado(d.status === 'ok' ? 'servidor conectado' : 'respuesta inesperada'))
      .catch(() => setEstado('sin conexión con el servidor'));
  }, []);
  return (
    <main className="pagina">
      <h1>Publicador de blogs</h1>
      <p>Crea borradores en WordPress. Nunca publica.</p>
      <p className="estado">Estado: {estado}</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
