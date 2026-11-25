import { createRoot } from 'react-dom/client';
import './styles.css';
import './theme.css'; // top bar + extra eye candy, loaded after styles.css so it wins the cascade
import App from './App.jsx';
import { mountLoginFx } from './fx.js';
createRoot(document.getElementById('root')).render(<App />);
mountLoginFx(); // live canvas animation on the login / sign-up hero