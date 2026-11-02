import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './lab.css';
import { captureKeyFromUrl } from './auth.js';

captureKeyFromUrl();

const rootElement = document.getElementById('root');
createRoot(rootElement).render(<App />);
