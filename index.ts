import { registerRootComponent } from 'expo';

// Registers the background location task; must be imported before the app renders.
import './src/tracking';
import App from './App';

registerRootComponent(App);
