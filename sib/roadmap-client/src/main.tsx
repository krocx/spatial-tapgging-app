import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import './styles.css';
import './studio.css';   // the 3D Studio on the brand system (tokens from /portal/brand/tokens.css)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
