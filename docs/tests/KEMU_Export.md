# Kemu Edge Export

Table of Contents
Edge Export
Export Modes: Javascript Library vs Shell Script
Export Process
Folder Structure
Using the Exported Recipe
SDK Helper Methods
Integration Examples
Deployment Considerations


Edge Export
Edge Export converts Kemu recipes into standalone Node.js applications that run independently of the Kemu platform. This enables:

Independent deployment: Run recipes on any server, cloud platform, or local machine
System integration: Embed recipe functionality into existing applications
Scalable architecture: Deploy multiple instances without platform dependencies
Note: Internet connection is required for Edge recipes to function unless you are on an enterprise plan.
The export process transforms visual recipe workflows into executable code while preserving all logic, connections, and custom functionality.



Export Modes: Javascript Library vs Shell Script
Kemu Edge Export supports two export modes optimized for different use cases:


Javascript Library Mode
Purpose: Creates a Node.js application for programmatic integration into existing projects
Execution: Run with node main.js or import as a module
Best For: Development environments, microservices, and applications requiring programmatic control

Shell Script Mode
Purpose: Creates a standalone executable with convenient startup scripts
Execution: Double-click start.bat (Windows) or start.sh (Linux/macOS)
Best For: Standalone deployment, non-technical users, and production environments

Key Difference: Shell Script mode includes startup scripts for easy execution, while both modes share identical core files and dependencies.



Export Process
UI Export Steps
To export a recipe from the Kemu UI:

Click the Home icon (house) in the Kemu interface
Select "Kemu Edge Export" from the available options
Optionally rename the export folder (defaults to recipe name)
Click the folder icon to choose the save location
Select the export mode (Javascript Library or Shell Script)
Click "Export" and wait for completion
The export process creates a complete, self-contained application package with all necessary dependencies and runtime components.

Custom InputsClick to enlarge


Folder Structure
An export package contains:

Recipe Name/
├── main.js                    # Main entry point for the recipe
├── package.json               # Node.js dependencies and configuration
├── package-lock.json         # Dependency lock file
├── recipe.kemu              # Recipe definition and configuration
├── .env                      # Environment variables and secrets
└── node_modules/            # Installed dependencies
Additional files (depending on export mode):

Shell Script Mode:

├── start.bat                # Windows startup script
└── start.sh                 # Linux/macOS startup script
With Custom Services:

└── services/                # Kemu services used by the recipe
    └── service-name@version/
        ├── dist/            # Compiled service code
        │   ├── processor.js  # Main service processor
        │   ├── manifest.json # Service metadata
        │   ├── variants/     # Service variants
        │   └── lib/          # Service libraries
        └── package.json      # Service-specific dependencies

Key Files:

main.js: Entry point that starts the recipe using Edge Runtime
package.json: Defines the project as a Workspace Configuration with Edge Runtime dependency
recipe.kemu: Complete recipe definition including widgets, connections, and custom logic
.env: Contains environment variables and all configured secrets for the recipe
services/: All Kemu service used by the recipe with compiled code and dependencies
start.bat/start.sh: Convenience scripts for Shell Script mode execution


Using the Exported Recipe
Basic Execution
Javascript Library Mode
Install dependencies: npm install
Start the recipe: node main.js

Shell Script Mode
Install dependencies: npm install
Start the recipe:
Windows: start.bat or node main.js
Linux/macOS: ./start.sh or node main.js


SDK Helper Methods
The Kemu Edge SDK provides comprehensive helper methods for working with recipes:

Available Methods
start() - Initialize and start the Kemu Edge Runtime
terminate() - Gracefully shut down the recipe runtime
sendToInputWidget() - Send data to input widgets in your recipe
sendToInputWidgetAndWaitForOutput() - Send data to input widgets and wait for output widget response
globalVariables - Manage global variables in your recipe
status - Monitor status values set by Status widgets
edgeFunctions - Register and manage edge function handlers
utils.loadImageFile() - Load images from various sources
utils.encodeImageData() - Encode image data to different formats such as "png", "jpeg", or "webp"

Basic Recipe Interaction
The default main.js file contains:

import kemuEdge from '@kemu-io/edge-runtime';

console.log('Starting recipe...');
await kemuEdge.start();
console.log('Recipe running...');

// To Send data to input widgets
/* import kemuEdge, { DataType } from '@kemu-io/edge-runtime';
const recipe = await kemuEdge.start();

await recipe.sendToInputWidget('INPUT_NAME', {
  type: DataType.Number,
  value: 123
});
*/
The start method initializes the Edge Runtime and begins executing your recipe. It returns a Recipe Instance that provides methods for interacting with your recipe. The commented section provides an example about how to interact with the exported recipe by sending data to an Input Widget.


Terminating the Recipe
The terminate method allows you to gracefully shut down the Edge Runtime and stop all recipe processing.

import kemuEdge from '@kemu-io/edge-runtime';

// Start the recipe
await kemuEdge.start();
console.log('Recipe running...');

// ... your application logic ...

// Terminate the recipe when done
await kemuEdge.terminate();
console.log('Recipe terminated');
Note: The terminate method is asynchronous and should be awaited to ensure proper cleanup before your application exits.


Data Types
import { DataType } from '@kemu-io/edge-runtime';

// Available data types
DataType.Number      // Numeric data (integer or floating point)
DataType.String      // Text data
DataType.ArrayBuffer // Raw binary data buffer
DataType.Array       // Array of items
DataType.Boolean     // True/false values
DataType.JsonObj     // JavaScript object (JSON-compatible)
DataType.Anything    // Accepts any data type (used by actions that don't care about the value)
DataType.ImageData   // Raw image data (produced in browser environments)
DataType.AudioBuffer // Raw audio data buffer
DataType.Rect        // Rectangle with width, height, top, left properties
DataType.Point       // Point with x, y coordinates
DataType.ImageBitmap // Image bitmap data
DataType.BinaryFile  // Custom binary data with format specification (e.g., `'image/png'`, `'audio/mp3'`)

Sending Data to Input Widgets
Input Widgets serve as the entry points for external data into your Kemu recipe. They act as receivers that accept data from your application code and pass it into the recipe workflow. This is the primary way to:

Trigger recipe execution: Send data to start or continue recipe processing
Provide external inputs: Feed data from your application into the recipe
Control recipe flow: Use different input widgets to handle different types of data
Integrate with external systems: Connect your application logic with Kemu recipe workflows
Important: Input Widgets must be configured in your recipe with specific names and data types. Your code must send data that exactly matches these configurations for successful communication.

Requirements:

Name Match: The Input Widget name in your recipe must exactly match the name passed to sendToInputWidget()
Data Type Match: The Input Widget's configured data type must match the DataType used in your code (see Data Type Mapping)
import kemuEdge, { DataType } from '@kemu-io/edge-runtime';

const recipe = await kemuEdge.start();

// Send string data (Input Widget must be named "greeting" and configured as "String" type)
await recipe.sendToInputWidget('greeting', {
  type: DataType.String,
  value: 'Hello World!'
});

// Send image data (Input Widget must be named "process-image" and configured as "Image" type)
await recipe.sendToInputWidget('process-image', {
  type: DataType.ImageData,
  value: imageData
});

// Send JSON object (Input Widget must be named "userData" and configured as "Object" type)
await recipe.sendToInputWidget('userData', {
  type: DataType.JsonObj,
  value: {
    id: 1,
    name: 'John Doe',
    email: 'john@example.com'
  }
});
Common mistakes:

Code calls 'process-image' but Input Widget is named 'image' → Will fail
Code uses DataType.ImageData but Input Widget is configured as "String" type → Will fail

Error Example: If you send the wrong data type, you'll see an error like:

Invalid data type: 0 for input: name. Expected: 1
This means the Input Widget expects a String (type 1) but a Number (type 0) was sent.



Sending Data and Waiting for Output
The sendToInputWidgetAndWaitForOutput method allows you to send data to an input widget and wait for the response from an output widget in the execution path. This is ideal for synchronous workflows where you need to wait for the recipe to complete processing before continuing.

This method is useful for:

Synchronous operations: Wait for recipe processing to complete before proceeding
Direct result retrieval: Get the output value directly without setting up listeners
Simplified code flow: Use async/await pattern instead of event listeners
API integrations: Return processed results directly in API responses
import kemuEdge, { DataType } from '@kemu-io/edge-runtime';

const recipe = await kemuEdge.start();

// Send data and wait for the output widget response
const result = await recipe.sendToInputWidgetAndWaitForOutput('process-data', {
  type: DataType.String,
  value: 'Hello World'
});

console.log('Recipe result:', result);
// The result contains the value sent to the output widget in the execution path
Important: This method requires an Output Widget in the execution path from the input widget. If no output widget is reached, the promise will hang indefinitely.



Global Variables Management
Global variables allow you to share data across your recipe and interact with it from external code. The global variables API provides methods to monitor, set, retrieve, and manage variables programmatically.

Available Methods:

onChange(varName, callback) - Listen for changes to a specific global variable
onChange('*', callback) - Listen for changes to all global variables
setValue(varName, value, config?) - Set the value of a global variable
getValue(varName) - Get the current value of a global variable
getAll() - Get all global variables
delete(varName) - Remove a global variable
Listening for Variable Changes:

import kemuEdge from '@kemu-io/edge-runtime';

const recipe = await kemuEdge.start();

// Listen for changes to a specific variable
recipe.globalVariables.onChange('output-image', (variable) => {
  console.log('Output image updated:', variable.lastValue);
  console.log('Variable name:', variable.name);
  console.log('Previous value:', variable.previousValue);
});

// Listen for changes to all variables
recipe.globalVariables.onChange('*', (variable) => {
  console.log('Any variable changed:', variable.name, variable.lastValue);
});

// Send data to trigger variable updates
await recipe.sendToInputWidget('process-image', imageData);
Setting and Getting Variables:

import kemuEdge from '@kemu-io/edge-runtime';

const recipe = await kemuEdge.start();

// Set a global variable value
await recipe.globalVariables.setValue('savePath', '/path/to/output.png');

// Set with options to control notifications
await recipe.globalVariables.setValue('config', {
  quality: 90,
  format: 'jpeg'
}, {
  disableChangeNotifications: false,  // Don't trigger change listeners
  disableDefineNotifications: false,  // Don't trigger define listeners
  doNotOverrideExisting: false        // Allow overwriting existing values
});

// Get a specific variable
const savePath = recipe.globalVariables.getValue('savePath');
console.log('Save path:', savePath?.lastValue);

// Get all variables
const allVariables = recipe.globalVariables.getAll();
console.log('All variables:', allVariables);

// Delete a variable
recipe.globalVariables.delete('savePath');
Unsubscribing from Changes:

The onChange method returns an unsubscribe function for cleanup:

const unsubscribe = recipe.globalVariables.onChange('output-image', (variable) => {
  console.log('Image updated:', variable.lastValue);

  // Stop listening after first update
  if (variable.lastValue) {
    unsubscribe();
  }
});


Status Monitoring
Status widgets allow your recipe to communicate status updates that can be monitored from external code. This is useful for tracking progress, errors, or state changes in your recipe workflows.

Listening for Status Changes:

import kemuEdge from '@kemu-io/edge-runtime';

const recipe = await kemuEdge.start();

// Listen for any status value changes
recipe.status.onChange((status) => {
  console.log('Status changed:', status.name);
  console.log('Status value:', status.value);
  console.log('Source widget:', status.sourceWidget);
  console.log('Status widget ID:', status.statusWidgetId);
});

// Send data that triggers status updates
await recipe.sendToInputWidget('setStatus', 'processing');
Unsubscribing from Status Changes:

const unsubscribe = recipe.status.onChange((status) => {
  console.log('Status:', status);

  // Stop listening after specific condition
  if (status.value.type === DataType.String && status.value.value === 'complete') {
    unsubscribe();
  }
});


Edge Functions
Edge functions allow you to register custom JavaScript handlers that can be called from within your recipe. This enables powerful customization where your recipe can invoke external code functions dynamically.

Registering a Function Handler:

import kemuEdge from '@kemu-io/edge-runtime';

const recipe = await kemuEdge.start();

// Register a handler for an edge function
recipe.edgeFunctions.register('do-something', async (event) => {
  console.log('Edge function called with:', event);

  // Perform custom logic
  const result = await performCustomOperation(event.data);

  // Return the result
  return result;
});

// When the recipe calls the 'do-something' edge function,
// your handler will be invoked with the event data.
// You recipe will wait for the result of the function and send it to its output port.
Unregistering a Function Handler:

// Remove a specific handler
recipe.edgeFunctions.unregister('do-something');

// Clear all registered handlers
recipe.edgeFunctions.clearAll();


Image Processing and Loading
Loading Images from Different Sources

import kemuEdge, { utils, DataType } from '@kemu-io/edge-runtime';

const recipe = await kemuEdge.start();

// Load image from URL
const image = await utils.loadImageFile('https://example.com/image.jpg');

// Load image from local file
const localImage = await utils.loadImageFile('./path/to/image.jpg');

// Load image from Base64 string
const base64String = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD...';
const imageFromBase64 = await utils.loadImageFile(base64String);


Integration Examples
Basic String Input with Asynchronous Output
This example demonstrates how to use an Input Widget as the entry point by using the sendToInputWidget asynchronous method, and receiving the result by monitoring global variable changes:


Drag the example onto the workspace to explore and experiment!



In this example:

Input Widget (greeting) receives the string "Hello World!" from the external code
Text Widget processes the input and generates a response "Hi there!"
Variable Widget (greeting-response) stores the response as a global variable
External Code receives the response through the global variable change listener and logs it to the console
Flow Summary: External Code → Input Widget → Text Widget → Global Variable → External Code Listener

How to Run This Example
Export the recipe as "Javascript Library Mode" from Kemu Edge
After exporting as a JavaScript library, open the exported project in your code editor (e.g., VS Code). The main.js file contains an example of how to start the recipe and send data to input widgets. By default, it looks like this:
import kemuEdge from '@kemu-io/edge-runtime';

console.log('Starting recipe...');
await kemuEdge.start();
console.log('Recipe running...');

// To Send data to input widgets
/* import kemuEdge, { DataType } from '@kemu-io/edge-runtime';
const recipe = await kemuEdge.start();

await recipe.sendToInputWidget('greeting', {
  type: DataType.Number,
  value: 123
});
*/
Replace the existing code with the code below (to simulate input after export)
import kemuEdge, { DataType } from '@kemu-io/edge-runtime';

console.log('Starting recipe...');
const recipe = await kemuEdge.start();
console.log('Recipe running...');

// Set up listener for the response variable
recipe.globalVariables.onChange('greeting-response', (variable) => {
  console.log('Received response:', variable.lastValue);
  console.log('Variable name:', variable.name);
  console.log('Previous value:', variable.previousValue);
});

// Send data to the input named "greeting"
await recipe.sendToInputWidget('greeting', {
  type: DataType.String,
  value: 'Hello World!'
});

console.log('Greeting sent, waiting for response...');
Open the exported folder in terminal and run:
npm install
node main.js
Note: If you enabled "Install dependencies" during export, npm install was already executed automatically. Key changes: Uncomment the example code, change DataType.Number to DataType.String, add the response listener, and modify the input value.

Expected Output: The terminal will display:

Starting recipe...
Recipe running...
Greeting sent, waiting for response...
Received response: Hi there!
Variable name: greeting-response
Previous value:
The recipe processes the input string "Hello World!" and returns the greeting response "Hi there!" through the Variable Widget, which triggers the global variable change listener.



Basic String Input with Synchronous Output
This example demonstrates how to use an Input Widget as the entry point by using the sendToInputWidgetAndWaitForOutput synchronous method, and awaiting for the result provided by the Output Widget:


Drag the example onto the workspace to explore and experiment!



In this example:

Input Widget (greeting) receives string data from external code via sendToInputWidgetAndWaitForOutput()
Text Widget processes the input and generates a greeting response: "Hi there!"
Output Widget transmits the final processed result directly back to external code

How to Run This Example
Export the recipe as "Javascript Library Mode" from Kemu Edge
Open the exported folder in your favorite code editor and modify the main.js file with the following code:
import kemuEdge, { DataType } from '@kemu-io/edge-runtime';

console.log('Starting recipe...');
const recipe = await kemuEdge.start();

console.log('Recipe running...');

// Send data and wait for output directly
const result = await recipe.sendToInputWidgetAndWaitForOutput('greeting', {
  type: DataType.String,
  value: 'Hello World'
});

console.log('Recipe result:', result);
Open the terminal and run:

npm install
node main.js
Note: If you enabled "Install dependencies" during export, npm install was already executed automatically.

Expected Output: The terminal will display:

Starting recipe...
Recipe running...
Recipe result: Hi there!
The recipe processes the input string "Hello World" and returns the greeting response "Hi there!" directly through the Output Widget.



Image Processing Integration
This example demonstrates a complete image processing workflow with file saving. The utils.encodeImageData method converts raw ImageData objects into common image file formats:


Drag the example onto the workspace to explore and experiment!



In this example:

Input Widget (process-image) receives image data from external code via sendToInputWidget()
Image Filter Widget applies grayscale filter to the received image
Image Resize Widget resizes the filtered image to 100x100 pixels
Variable Widget (image-processed) stores the processed result as a global variable
External Code receives the processed image through the global variable change listener and saves it as a JPEG file

How to Run This Example
Export the recipe as "Javascript Library Mode" from Kemu Edge
Open the exported folder in your favorite code editor and modify the main.js file with the following code:
import path from 'path';
import fs from 'fs';
// NOTE: contains helper functions to manipulate images
import kemuEdge, { utils, DataType } from '@kemu-io/edge-runtime';

// Start recipe
const recipe = await kemuEdge.start();

// Load image from URL
const image = await utils.loadImageFile('https://cdn.pixabay.com/photo/2012/01/09/09/10/sun-11582_1280.jpg');
console.log('Image loaded');

// Create a listener for when the image is processed
recipe.globalVariables.onChange('image-processed', async (variable) => {
  try {
    const image = variable.lastValue;
    const targetPath = path.resolve('./image-processed.jpeg');
    console.log(`Image processed, saving file to "${targetPath}"`);
    const jpgBuffer = await utils.encodeImageData(image, 'jpeg');
    fs.writeFileSync(targetPath, jpgBuffer);
    process.exit(0);
  } catch(error) {
    console.error('Error saving image', error);
    process.exit(1);
  }
});

// Send image to input widget
await recipe.sendToInputWidget('process-image', {
  type: DataType.ImageData,
  value: image
});
Note, some important code in the modify file:

utils.loadImageFile(url): Loads an image from a URL or file path and returns it as ImageData, which can be sent to the input widget
recipe.globalVariables.onChange('image-processed', async (variable) => { ... }): Listens for changes to the image-processed global variable, so you can react when the image processing is complete and save the result
Open the terminal and run:

npm install
node main.js
Note: If you enabled "Install dependencies" during export, npm install was already executed automatically.

Expected Output: The terminal will display:

Image loaded
Image processed, saving file to "/path/to/your/exported/folder/image-processed.jpeg"
The recipe processes the image from the URL, applies grayscale filter and resizes it to 100x100 pixels, then saves the result as image-processed.jpeg in the exported folder.



Express.js Integration
This example demonstrates how to integrate an Express server with a Kemu recipe by sending an API request with an imageUrl, which the recipe processes and returns as a Base64 string in the response:


Drag the example onto the workspace to explore and experiment!



In this example:

Input Widget (process-image) receives ImageData from external code via sendToInputWidgetAndWaitForOutput()
Image Filter Widget applies grayscale filter to the received image
Image Resize Widget resizes the filtered image to 100x100 pixels
Output Widget transmits the processed image directly back to external code
External Code receives the processed image and converts it to Base64 for the API response

How to Run This Example
Export the recipe as "Javascript Library Mode" from Kemu Edge
Open the exported folder in your favorite code editor and modify the main.js file with the following code:
import express from 'express';
import kemuEdge, { utils, DataType } from '@kemu-io/edge-runtime';

const app = express();
app.use(express.json());

// Route that triggers the recipe
app.post('/api/process-image', async (req, res) => {
  const { imageUrl } = req.body;
  const image = await utils.loadImageFile(imageUrl);

  console.log('Starting recipe...');
  const recipe = await kemuEdge.start();

  // Send image to input widget
  const result = await recipe.sendToInputWidgetAndWaitForOutput('process-image', {
    type: DataType.ImageData,
    value: image
  });

  const jpgBuffer = await utils.encodeImageData(result, 'jpeg');
  res.json({
    success: true,
    image: `data:image/jpeg;base64,${jpgBuffer.toString('base64')}`
  });
});

// Start the server
app.listen(3000, () => console.log('Server running on port 3000'));
Open the terminal and run:

npm install express
node main.js
Note: If you enabled "Install dependencies" during export, npm install was already executed automatically.

Test the API using Postman:

Method: POST
URL: http://localhost:3000/api/process-image
Headers: Content-Type: application/json
Body (raw JSON):
{
  "imageUrl": "https://cdn.pixabay.com/photo/2012/01/09/09/10/sun-11582_1280.jpg"
}
Expected Output:

Terminal: The server will display:
Server running on port 3000
Postman Response: The API will return a JSON response:
{
  "success": true,
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
}
The recipe processes the image from the URL, applies grayscale filter and resizes it to 100x100 pixels, then returns the processed image as a Base64 string in the API response.



Deployment Considerations
System Requirements
Node.js: Version 22.2.0 or higher required
Platform Support: Windows, macOS, and Linux (multiple architectures)
Memory: Adequate RAM for image processing workflows
Storage: Space for dependencies and temporary files
Best Practices
Testing: Test exported recipes in target environment before deployment
Error Handling: Implement proper error handling in custom logic
Resource Monitoring: Monitor CPU and memory usage for independent Recipe Instances
Process Management: Use process managers like PM2 for production deployments
Security: Consider security implications when exposing webhooks publicly
Performance Considerations
Image Processing: Large images may require significant memory allocation
Concurrent Requests: Monitor resource usage under high load
Service Initialization: Allow adequate startup time for Service Dependencies initialization


Glossary
Edge Runtime
The standalone execution environment that runs exported Kemu recipes independently of the Kemu platform. It provides the necessary APIs and utilities for interacting with recipes programmatically.

Recipe Instance
The object returned by kemuEdge.start() that provides methods for sending data to input widgets and managing recipe execution. Each recipe instance represents a running copy of your exported recipe.

Event Listener
A callback function that responds to specific events in the recipe, such as variable changes or widget outputs. Listeners allow external code to react to recipe state changes in real-time.

Data Type Mapping
The correspondence between Kemu Edge data types (like DataType.String, DataType.Number) and the data types configured in your recipe widgets. Proper mapping is essential for successful data transmission.

Recipe State
The current values and configuration of all widgets in a running recipe. The state persists during recipe execution and can be monitored through variable change listeners.

Export Package
The complete set of files generated when exporting a recipe, including the recipe definition, dependencies, runtime components, and any custom services used by the recipe.

Service Dependencies
Additional Kemu services (like custom widgets or external integrations) that your recipe requires to function. These are automatically included in the export package when present.

Workspace Configuration
The package.json file in exported recipes that defines the project as a workspace with Kemu Edge Runtime as a dependency, enabling proper module resolution and execution.

Process Management
The handling of recipe lifecycle events like startup, execution, and termination. Proper process management ensures clean resource cleanup and prevents memory leaks in long-running applications.


# Global Variables Panel

Table of Contents
Global Variables Panel Overview
Panel Functionality
Accessing the Panel
Global Variables Panel Interface
Creating Global Variables
Editing Global Variables
Real-Time Updates in Connected Widgets
Control Types
Shared UI Actions (Available for All Variables)
1. Anything
2. Number
3. Slider
4. Text
5. MultilineText
6. Dropdown
7. Image
8. BinaryFile
9. Checkbox
10. MultiSelect
11. Button
12. Group
Practical Use Case with Multiple Control Types
File and Image Handling
Image Variables
Binary File Variables
Integration with the Global Variable Widget
Variable Reference
Reactive Behavior
Change Propagation
Use Case Examples
Reactive Number Variables for Automatic Calculations
Boolean Variable with Conditional Logic
Use Cases and Examples: Centralized Recipe Control
Centralized Message Composition
Dynamic Global Variables with Script Initialization (Session & 2FA)


Global Variables Panel Overview
The Global Variables Panel is a centralised interface component in Kemu that provides a single location to create, configure, and manage Global Variables used throughout your recipes. Global Variables are values that persist during recipe execution and can be accessed and modified from any widget in the workflow or directly from the panel interface.

The panel functions as the primary interface for Global Variable configuration and management, providing:

Centralized variable management — Single interface for variable creation, modification, and deletion
Runtime control — Variable value modification at runtime without workflow modification; changes propagate immediately to connected widgets
Configuration sharing — Variable values shared across multiple workflows within the same recipe
Organization — Hierarchical grouping of related variables
Variables created in the panel are immediately available to widgets, expressions, and services throughout the recipe. The Global Variable Widget provides programmatic access to these variables within workflows, performing read and write operations. When a variable value changes in the panel or through a widget, all widgets, expressions, and services that reference that variable receive the updated value immediately.



Panel Functionality
Accessing the Panel
The Global Variables Panel is accessed through the Logic Mapper's Settings menu. To open or close the panel:

Click the gear icon in the top-right corner of the canvas to open the Settings menu
In the Settings menu, locate the "Global Variables Panel" toggle
Enable the toggle to display the panel on the screen
Disable the toggle to hide the panel

Global Variables PanelClick to enlarge


Global Variables Panel Interface


When initialized, the panel displays an empty table layout with two columns:

Name — Column reserved for variable names
Value — Column displaying the current value of each variable using the appropriate control type
When no variables exist, only the table headers and top-bar controls are visible.

Top-Bar Controls

The top bar provides panel-level actions:

Add Variable — Opens a modal for creating new variables. The modal contains:
Variable Name — Text field accepting names that start with a letter and contain only letters, numbers, underscores, or spaces
Control Type — Selection from available types: Anything, Number, Slider, Text, Multiline Text, Dropdown, Image, Binary File, Checkbox, MultiSelect, Button, or Group
Group — Optional field for assigning the variable to an existing group. Visible only when at least one Group variable exists
Help Text — Optional text field for variable description

Three-dot menu (⋯) Provides configuration management operations for the panel:

Download Configuration — Exports a JSON file containing the current configuration of all variables. Each variable is represented as an object within a globalVariables array. The export can include or exclude stored values.
{
"globalVariables": [
   {
      "name": "welcome_message",
      "controlType": "text",
      "controlSettings": { "value": "", "placeholder": "Enter text" },
      "group": null,
      "order": 1,
      "lastValue": "<stored value>",
      "lastDataType": 1
   }
]
}

Copy Configuration — Copies the configuration of all variables to the clipboard. The copied data can be pasted into external files or transferred to another recipe. The copy operation can include stored values or only variable definitions.

Paste Configuration — Inserts a previously copied configuration with two modes:

Add to Existing — Appends copied variables without modifying existing variables
Replace Existing — Clears all existing variables and replaces them with the pasted configuration
Import Configuration — Opens the system file explorer for uploading a JSON configuration file. All variables contained in the file are loaded into the panel.


Panel Controls

The panel includes secondary interface controls:

Minimize Panel — Collapses the panel into a compact bar to reduce obstruction of the logic map
Move Panel — Drag handle located in the top-left corner enables repositioning the panel within the logic map
Resize Panel — Resize handle in the lower-right corner adjusts the panel dimensions


Creating Global Variables


To create a new global variable:

Click the "+" button at the top of the panel.
An "Add Variable" modal opens with the following fields:
Variable Name — Unique identifier for the variable. Must start with a letter and use only letters, numbers, underscores, and spaces.
Control Type — Select the control type (String, Number, Dropdown, etc.)
Help Text (optional) — Describes the variable’s function. It appears as a help icon (?) next to the name and is shown on hover.
Click "Create" to add the variable.
Note — The Group field appears only if at least one Group-type variable already exists.



Editing Global Variables
Edition Panel — The gear icon next to each variable opens the configuration panel, which enables modification of:

Control Type — Changes the control type used by the variable
Control-Specific Settings — Configuration options that vary by control type
Help Text — Text field for variable description, displayed through the help icon
Group Assignment — Assignment of the variable to an existing group
Clicking "Save" applies the changes to the variable.
Clear Value Option — The clear value option removes the stored value while preserving the variable definition and configuration.

Deleting Global Variables — The bin icon next to each variable removes the variable immediately and permanently, including all stored values. Deleting a group variable removes all variables contained within that group.

Reordering Variables — Variables support reordering via drag and drop:

Use the drag handle (six vertical dots) to the left of each variable to change its position.
Release the variable to apply the new order in the list.
To move a variable into a group, drag it over the group row until a blue highlight line appears under the group name, then release.


Real-Time Updates in Connected Widgets
This example demonstrates real-time value propagation: a numeric Global Variable updates and triggers evaluation through a Switch Widget. With Reactive Mode enabled, the connected Text Widget receives and displays the result immediately.


Drag the example onto the workspace to explore and experiment!



In this example

The Global Variable Widget references the score variable (number control type, Number data type) with Auto-emit on variable change enabled.

When the score value changes in the Global Variables Panel, the Global Variable Widget automatically transmits the updated Number value to the Switch Widget (Number data type).

The Switch Widget evaluates conditions using $vars.score:

If score >= 16 && score < 20: The first output triggers and outputs "Excellent Work!"
If score >= 10 && score < 16: The second output triggers and outputs "Acceptable performance."
Based on the condition result, the corresponding Text Widget receives the string value and displays the message.

Reactive Mode Behavior

With reactive mode enabled, changing the score value in the panel immediately updates the stored value and triggers conditional evaluation. Global Variables propagate updated values to connected widgets in real time:

Variable changes in the panel immediately notify all widgets linked to that variable.
Widgets with reactive mode enabled automatically output the updated value.
Variable modifications adjust recipe behavior without workflow modification.


Control Types
The Global Variables Panel supports different control types that determine how each variable is displayed and edited in the interface. Each control type is designed for a specific data type and use case.


Shared UI Actions (Available for All Variables)
These UI actions are available for every Global Variable, regardless of control type:

Help Text (tooltip icon) — Displays the HelpText assigned to the variable on hover.

Generate Event with Current Value — Transmits the current value to connected widgets. Used when Global Variable Widgets have Auto-emit on variable change enabled.

Editing and Configuration Options:

Configure — Opens a modal with Control Type, Help Text, and Group Settings (Group Settings appear only if a group variable was previously created).
Clear Value (X) — Removes the current stored value (lastValue).
Delete — Removes the Global Variable completely.


1. Anything
Description — Variables of type Anything have no specific UI control for editing values. Values cannot be manually set or edited in the Global Variables Panel; they must be received from the workflow. The panel displays the value that the variable receives at runtime.

When to use — Suitable for storing values of mixed types or when the type is not determined in advance.

Usage examples:

Storing dynamic results from APIs that may return different data types
Storing intermediate workflow data that may vary in structure

Anything VariableClick to enlarge
Anything Variable Interface

Name — Displays the variable name
Value — Displays the detected data type (e.g., <String>, <Number>, <ImageData>). Read-only; reflects data from the workflow
Editing and Configuration Options:
Additional Options — Additional actions may appear depending on the data type (e.g., copy or download tools for image-based values)
Standard actions — Described in the "Shared UI Actions" section above


2. Number
Description — Control type for storing and managing numeric values. Accepts integer and decimal numbers.

When to use — For numeric values that require manual entry or adjustment in the panel.

Usage examples:

Temperature settings
Time limits in seconds
Percentage values

Number VariableClick to enlarge
Number Variable Interface

Name — Displays the variable name
Value — Editable input field displaying the current numeric value. Supports direct numeric input and spinner controls (increment/decrement arrows) for value adjustment
Editing and Configuration Options:
Standard actions — Described in the "Shared UI Actions" section above


3. Slider
Description — Control type for numeric values adjusted through a visual slider. Requires defined minimum, maximum, and step values.

When to use — When a value must remain within a fixed range and be adjusted via drag control.

Usage examples:

Volume control
Threshold settings

Slider VariableClick to enlarge
Slider Variable Interface

Name — Displays the variable name
Value — Displays the current numeric value with a slider control. Value adjustment occurs via drag interaction with the slider handle
Editing and Configuration Options:
Configure — Opens a modal with slider-specific settings:
Minimum Value — Lowest allowed number
Maximum Value — Highest allowed number
Step — Increment between values when dragging the slider
Standard actions — Described in the "Shared UI Actions" section above


4. Text
Description — Control type for storing and managing single-line text values. Supports optional placeholder text.

When to use — For short text values such as names, titles, URLs, etc.

Usage examples:

Username
API URL
Document title

Text VariableClick to enlarge
Text Variable Interface

Name — Displays the variable name
Value — Editable input field displaying the current text value
Editing and Configuration Options:
Place Holder — Displays a hint in the input when the field is empty
Standard actions — Described in the "Shared UI Actions" section above


5. MultilineText
Description — Control type for storing and managing multi-line text values. Supports optional placeholder text.

When to use — For long texts, descriptions, message content, etc.

Usage examples:

Product description
Email content
Extensive notes or comments

MultilineText VariableClick to enlarge
MultilineText Variable Interface

Name — Displays the variable name
Value — Editable multi-line input field displaying the current text value. Supports direct multi-line text input
Editing and Configuration Options:
Place Holder — Displays a hint in the input when the field is empty
Standard actions — Described in the "Shared UI Actions" section above


6. Dropdown
Description — Control type for storing and managing single selection from predefined options. Allows only one selection from a dropdown menu.

When to use — When the variable must be restricted to a controlled set of predefined values.

Usage examples:

Language selection
Notification type
Order status

Dropdown VariableClick to enlarge
Dropdown Variable Interface

Name — Displays the variable name
Value — Dropdown control displaying the current selected option. Supports single selection from the predefined list
Editing and Configuration Options:
Options — Defines the list of selectable values available in the dropdown. Options are stored as an array of strings (string[]) and can include text or numeric values (e.g., "EN", "ES", "1", "2")
Standard actions — Described in the "Shared UI Actions" section above


7. Image
Description — Control type for loading, visualizing, and managing images. Accepts ImageData data type.

When to use — For storing images used in the recipe.

Usage examples:

Company logo
Product images
User avatars
Background images

Image VariableClick to enlarge
Image Variable Interface

Name — Displays the variable name
Value — Stores the image in DataURL format (Base64-encoded) and displays a preview thumbnail in the panel
Editing and Configuration Options:
Upload Image — Loads images via drag and drop or file selection from the upload area
Change — Replaces the current image
Copy — Copies the image to the clipboard
Download — Downloads the current image file
Standard actions — Described in the "Shared UI Actions" section above


8. BinaryFile
Description — Control type for loading and managing binary files of any type. Accepts BinaryFile data type, which can store files with any valid MIME type (e.g., image/png, application/pdf, text/plain, audio/mpeg, video/mp4).

When to use — For storing files processed or used in the recipe.

Usage examples:

PDF documents
Configuration files
Data in specific binary format

BinaryFile VariableClick to enlarge
BinaryFile Variable Interface

Name — Displays the variable name
Value — Stores the file as a BinaryFile object with binary data encoded as a Base64 string. The stored structure includes the file's MIME type, filename, and Base64-encoded data. Displays file information (name, type, size) in the panel. For some types (such as images), a preview may be shown
Editing and Configuration Options:
Change — Replaces the current file. Opens the system file explorer for file selection. Files can also be updated via drag and drop
Download — Downloads the stored file
Configure — Opens the configuration panel
Standard actions — Described in the "Shared UI Actions" section above


9. Checkbox
Description — Control type for boolean values represented as an on/off toggle. Stores a true or false state.

When to use — When a setting, option, or behavior requires enable/disable functionality via a simple toggle.

Usage examples:

Enable or disable notifications
Turn a feature on or off

Checkbox VariableClick to enlarge
Checkbox Variable Interface

Name — Displays the variable name
Value — Displays the current boolean state as a toggle (On/Off). Toggle state changes update the stored value
Editing and Configuration Options:
Configure — Opens a modal with checkbox-specific settings:
Default Value — Sets the initial toggle state (True/False) used when the variable is created
Standard actions — Described in the "Shared UI Actions" section above


10. MultiSelect
Description — Control type for storing and managing multiple selections from predefined options. Allows selecting multiple options from a dropdown menu.

When to use — When multiple options must be selected from a list.

Usage examples:

Product categories
User permissions
Tags

MultiSelect VariableClick to enlarge
MultiSelect Variable Interface

Name — Displays the variable name
Value — Multi-select dropdown control displaying the current selected options. Supports multiple selection from the predefined list
Editing and Configuration Options:
Configure — Opens a modal with multi-select-specific settings:
Options — Array of strings with available options (e.g., ["Electronics", "Clothing", "Home"])
Standard actions — Described in the "Shared UI Actions" section above


11. Button
Description — Control type that displays as a button and triggers actions when clicked. Stores boolean values.

When to use — For creating controls that trigger events or actions in the recipe.

Usage examples:

"Start Process" button
"Reset" button
"Export Data" button

Button Variable Interface

Name — Displays the variable name
Value — Button control that stores a boolean value and triggers an event when clicked. To execute the recipe when the button is clicked, connect a Global Variable Widget to this variable and enable Auto-emit on variable change in the widget settings
Editing and Configuration Options:
Standard actions — Described in the "Shared UI Actions" section above

Use Case Description

Manual Control of Loop Execution Using Button Variables

This example demonstrates manual control of loop execution using Button Global Variables. One button initializes the loop with a predefined list of values; another button advances the loop step by step, providing manual control over item processing.


Drag the example onto the workspace to explore and experiment!



In this example

Button 1 triggers the Text Widget to output a JSON string (String data type)
The Text to Object Widget parses the string into an Array (Array data type)
The Loop Widget receives the array and initializes with three items (autoLoop disabled)
Button 2 triggers the Loop Widget next port (Boolean data type)
The Loop Widget advances and outputs the current item and index (String and Number data types)
Text Widgets display the current item value and index


12. Group
Description — A Group variable organizes Global Variables into logical sections within the Global Variables Panel. It does not store a value itself; it only contains other variables.

When to use — For organizing related variables into categories.

Usage examples:

"Configuration" group with settings variables
"API" group with credentials and endpoints
"UI" group with interface variables
Key behavior:

A Group has no value. Only variables inside the group store values.
Once a Group is created, all other variables can be assigned to it using the Group selector in their configuration modal.
Variables remain fully editable; the Group only affects organization.
Groups can be nested inside other groups to:
Structure large configurations (e.g., App → UI → Typography)
Separate concerns within the same feature
Improve navigation in complex projects

Group VariableClick to enlarge
Group Variable Interface

Name — Displays the group name
Variables — Displays variables nested within the group. Variables are displayed hierarchically under the group name
Options Menu (⋯) — Available actions for managing grouped configurations:
Download configuration — Exports the group structure (with or without values) as a .json file
Copy configuration — Copies the group configuration to the clipboard
Paste configuration — Pastes a copied configuration, with the option to replace or merge
Import configuration — Imports a configuration from a .json file
Editing and Configuration Options — Opens the configuration modal with the following fields:
Control Type — Fixed to Group and cannot be changed
Group — Allows nesting this group inside another existing group without using drag and drop
Standard actions — Described in the "Shared UI Actions" section above


Practical Use Case with Multiple Control Types
This example demonstrates multiple Global Variables with different control types used together to manage application-level configuration. A Slider Widget and a Dropdown Widget are grouped under a single configuration context, enabling interface-related settings—such as language and font size—to be adjusted dynamically and represented as a unified configuration object.


Drag the example onto the workspace to explore and experiment!



In this example

The Slider Widget updates its value and sends it to the Sequence Widget (Number data type)
The Sequence Widget executes sequentially: first triggers the language Global Variable Widget (Dropdown) to read its value, then triggers the font_size Global Variable Widget (Slider) to set its value (Number data type)
Both Global Variable Widgets (with reactive mode enabled) automatically transmit their values to the Object Widget (String and Number data types)
The Object Widget combines both values into a single object (JsonObj data type)
The Object to Text Widget converts the object to a JSON string (String data type)
The Text Widget displays the resulting JSON configuration


File and Image Handling
This section describes how Image and Binary File variables handle files once stored in the Global Variables Panel, including setting, viewing, and exporting operations. Control-type creation and basic upload methods are covered in the Control Types section.


Image Variables
Image variables store image data as ImageData objects and display thumbnail previews in the panel.

Setting Images:

Images are added via drag and drop of an image file directly onto the variable
Once added, the image is immediately stored and displayed in the panel
Viewing Images:

The variable displays a thumbnail preview of the stored image
The image is stored internally as Base64-encoded ImageData
This enables image persistence across sessions and exports
Exporting Images:

Download icon — Downloads the image as a file in its original format
Copy icon — Copies the image data to the clipboard
Download Configuration (Global Variables Panel) — Exports the variables configuration as JSON, with image data serialized in Base64 format

Drag the example onto the workspace to explore and experiment!



In this example

The workflow is triggered using Generate Event with Current Value in the panel
The Global Variable Widget requires Auto-emit on variable change to be enabled
The Global Variable Widget reads the ImageData from the source_image variable (ImageData data type)
The Image Filter Widget applies an invert filter to the image (ImageData data type)
The Display Widget shows the processed image


Binary File Variables
Binary File variables store files as BinaryFile objects. Each BinaryFile contains three properties: format (MIME type as a string), fileName (filename as a string), and data (binary content as an ArrayBuffer). When stored in configurations, the data property is serialized as a Base64-encoded string.

Setting Files - Files are added via drag and drop or the upload button. Binary File variables accept files of any type, including documents, archives, media files, and images

Viewing Files - The panel displays basic file metadata (name and size) but does not provide visual previews. All files are treated as generic binary assets, regardless of their MIME type

Exporting Files:

Download icon — Downloads the stored file to the file system
Configuration export — When exporting Global Variables as JSON, the file is included as encoded binary data
In the exported configuration, Binary File values include metadata such as the file name, MIME type, and encoded content.


Drag the example onto the workspace to explore and experiment!



In this example

The workflow is triggered using Generate Event with Current Value in the panel
The Global Variable Widget requires Auto-emit on variable change to be enabled
The Global Variable Widget reads the BinaryFile from the binary_file variable (BinaryFile data type)
The Get Property Widget extracts the format and fileName properties (String data types)
Two Text Widgets display the MIME type and file name respectively



Integration with the Global Variable Widget
The Global Variable Widget connects workflows to variables defined in the Global Variables Panel. See the Global Variable Widget documentation for complete details.


Variable Reference
The Global Variable Widget references variables through its Variable Name setting:

When configuring the widget, a dropdown displays all variables available in the Global Variables Panel
Selecting a variable name from the dropdown connects the widget to that variable
Variable names cannot contain dots (.) or hyphens (-); use underscores (_) or spaces instead
For grouped variables, use the full path notation (e.g., app.language)
When workflows are duplicated, saved and reopened, or copied into a clean Logic Mapper, only variables that were explicitly defined through Global Variable Widgets (or created in the Global Variables Panel) are loaded into the panel. Variables referenced only via inline expressions (for example $vars.score, $vars["session.user.name"], or Template String expressions such as {{$vars.department}}) are not automatically created or loaded unless they were previously defined as global variables.


Reactive Behavior
The Auto-emit on variable change setting controls how the widget responds to variable changes:

When Enabled:

The widget automatically forwards the variable's value to connected child widgets when:
The variable is changed from the Global Variables Panel
The variable is changed by another widget via the setValue port
The widget's own setValue port is triggered
Changes in the panel immediately propagate through reactive widgets to their connected children
When Disabled:

The widget can store and read variable values but does not automatically forward them to connected child widgets
To transmit the value, the read input port must be explicitly triggered
When the setValue port is triggered, the value is stored and other reactive widgets subscribed to the variable are notified, but this widget does not forward the value to its own children
This widget does not subscribe to external changes (from the panel or other widgets), so it does not automatically react to or forward those changes

Change Propagation
When a variable value changes:

From Panel — Changing a value in the panel notifies all widgets subscribed to that variable. Reactive widgets automatically forward the new value to their connected child widgets

From Widget — When a widget writes a value via the setValue port:

The value is immediately stored and reflected in the panel
All widgets subscribed to that variable receive a notification
Reactive widgets automatically forward the value to their connected children
Bidirectional Sync — Reactive widgets subscribed to the variable automatically forward the value to their connected children



Use Case Examples
Reactive Number Variables for Automatic Calculations
This example demonstrates reactive mode: a Global Variable Widget automatically forwards values to connected widgets when updated. With reactive mode enabled, changes propagate immediately through the workflow without requiring manual triggers.


Drag the example onto the workspace to explore and experiment!



In this example

The Global Variable Widget references the Factor variable (slider control type, Number data type) with Auto-emit on variable change enabled

The Slider Widget transmits a numeric value (2-10) to the Global Variable Widget setValue input port (Number data type)

The Global Variable Widget stores the value and, due to reactive mode, automatically forwards it to the Expression Eval Widget data input port (Number data type)

The Expression Eval Widget evaluates the expression data * $vars.Table, multiplying the input value by the Table global variable accessed via $vars.Table (Number data type)

The Display Widget receives the calculation result and renders it (Number data type)

Reactive Mode Behavior

With reactive mode enabled, value changes propagate automatically through connected widgets. When the slider value changes, the stored value updates and the calculation executes without manual intervention. In non-reactive mode, the read input port must be explicitly triggered to forward values to downstream widgets.

Note: In this example, the Factor variable is created and managed automatically by the Global Variable Widget in the snippet, while the Table value is read directly using $vars.Table. When you drag this snippet into the Logic Mapper, you only need to create the following variable in the Global Variables Panel:

Table — Number control type, representing the base value for the multiplication (e.g., 5)


Boolean Variable with Conditional Logic
This example demonstrates reactive mode using a Boolean checkbox variable to control conditional workflow execution. When the checkbox state changes, the workflow automatically evaluates the condition and displays the appropriate message.


Drag the example onto the workspace to explore and experiment!



In this example

The Global Variable Widget references the isAdmin variable (checkbox control type, Boolean data type) with Auto-emit on variable change enabled

When the checkbox state changes in the Global Variables Panel, the Global Variable Widget automatically transmits the updated Boolean value to the Conditional Widget

The Conditional Widget evaluates the input value against the configured condition (Equal to true). Based on the evaluation result:

If the condition is satisfied (true): The then output port is triggered
If the condition is not satisfied (false): The else output port is triggered
Conditional execution branches:

True branch: The then output triggers a Text Widget that outputs "Access Granted"
False branch: The else output triggers a Text Widget that outputs "Access Denied"
The final Text Widget receives the string value through the setText input port and renders the message

Reactive Mode Behavior

With reactive mode enabled, toggling the checkbox in the panel immediately updates the stored value and triggers the conditional evaluation. The workflow executes automatically without manual intervention, demonstrating real-time reactive updates for Boolean-based conditional logic.



Use Cases and Examples: Centralized Recipe Control
The Global Variables Panel acts as a centralized control layer for recipes. Global Variables are not limited to manual configuration in the panel. They can be:

Defined or updated by scripts
Read by widgets, expressions, and services
Referenced dynamically using Template String and Expression Eval
Used together with secrets for secure configuration values
This enables recipes to separate logic from configuration, shared data, and environment-specific values.


Centralized Message Composition
This example demonstrates how Global Variables centralize configuration values used across a recipe. Message parts such as prefixes, suffixes, and shared labels are stored in the Global Variables Panel and read by a Template String Widget at runtime. Updating any value in the panel immediately affects the rendered message without changing the workflow logic.


Drag the example onto the workspace to explore and experiment!



In this example:

Global Variables provide the message components:

Grouped variables from the welcome_msg group, accessed with:
$vars["welcome_msg.msg_prefix"]  // "Welcome to Kemu"
$vars["welcome_msg.msg_suffix"]  // "We are glad to have you onboard!"
Standalone variable, accessed with:
$vars.department  // "Support"
The Text Widget supplies the name (e.g., "Maria")

The Button Widget triggers the entire workflow

The Template String Widget combines:

the grouped variables,
the standalone variable,
and the input value
with the following template:

{{$vars["welcome_msg.msg_prefix"]}}
{{$vars.department}} team,
{{input.value}}!
{{$vars["welcome_msg.msg_suffix"]}}
Using the example values, the final message would be:

Welcome to Kemu
Support team,
Maria!
We are glad to have you onboard!
The final Text Widget displays the completed message

Note: In this example, the global variables are referenced directly using $vars[...] notation and no Global Variable Widget is used. When you drag this snippet into the Logic Mapper, you must first create the required variables in the Global Variables Panel:

A Group variable named welcome_msg
Inside that group:
msg_prefix — Text control type, value: "Welcome to Kemu"
msg_suffix — Text control type, value: "We are glad to have you onboard!"
A standalone variable department — Text control type, value: "Support"


Dynamic Global Variables with Script Initialization (Session & 2FA)
This example demonstrates how Global Variables are created and structured dynamically at runtime using a script. The workflow initializes a session state, generates user-related data, and creates a session-level Two-Factor Authentication (2FA) code, all without predefining any variables in the Global Variables Panel.


Drag the example onto the workspace to explore and experiment!



In this example:

The Button Widget triggers the workflow and starts the session initialization

The Script Widget runs and creates the Global Variables structure at runtime:

Creates the top-level session group
Creates the nested session.user group
Sets session.user.name and session.user.surname
Generates a random 6-digit 2FA code
Stores the code as session.2faCode
The Script Widget reads back session.2faCode and sends it through its output port (2FA Code)

The Template String Widget formats the final message using:

Nested Global Variables: $vars["session.user.name"] and $vars["session.user.surname"]
The workflow input value (the 2FA code): {{input.value}}
The Text Widget renders the final message:

Rendered output:

Hello John Doe !!

This is your verification code:
806715