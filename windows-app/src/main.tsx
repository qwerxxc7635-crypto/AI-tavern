import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import { installDocumentLocale } from './localization/index.js';
import { AppRoutes } from './routes.js';
import './theme.css';

const root = document.querySelector('#root');
if (root === null) throw new Error('Application root element is missing');
installDocumentLocale(document);

createRoot(root).render(
  <StrictMode>
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  </StrictMode>,
);
