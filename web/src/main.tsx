import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import './styles.css';
import { Layout } from './components/Layout';
import { ActorProvider } from './hooks/actor';
import { WalletProvider } from './lib/wallet';
import { FrontPage } from './pages/FrontPage';
import { TakeoverDesk } from './pages/TakeoverDesk';
import { PressOffice } from './pages/PressOffice';
import { Receipts } from './pages/Receipts';
import { NotFound } from './pages/NotFound';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <FrontPage /> },
      { path: '/takeover', element: <TakeoverDesk /> },
      { path: '/press', element: <PressOffice /> },
      { path: '/receipts', element: <Receipts /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <ActorProvider>
        <RouterProvider router={router} />
      </ActorProvider>
    </WalletProvider>
  </StrictMode>,
);
