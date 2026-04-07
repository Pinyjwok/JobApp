import kemuEdge from '@kemu-io/edge-runtime';

console.log('Starting recipe...');
await kemuEdge.start();
console.log('Recipe running...');


// To Send data to input widgets
/* import kemuEdge, { DataType } from '@kemu-io/edge-runtime';
const recipe = await kemuEdge.start();

const result = await recipe.sendToInputWidgetAndWaitForOutput('INPUT_NAME', {
  type: DataType.Number,
  value: 123
});

console.log('Recipe result:', result);
*/
