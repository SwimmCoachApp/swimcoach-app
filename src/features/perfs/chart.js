/**
 * Chart.js réduit au graphique de progression (courbe, axes catégorie / linéaire, infobulle).
 * Chargé par `import()` seulement à l'ouverture d'un graphique : morceau séparé du reste de l'application.
 */
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

export { Chart };
