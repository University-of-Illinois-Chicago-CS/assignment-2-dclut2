import vertexShaderSrc from './vertex.glsl.js';
import fragmentShaderSrc from './fragment.glsl.js'

var gl = null;
var vao = null;
var program = null;
var vertexCount = 0;
var uniformModelViewLoc = null;
var uniformProjectionLoc = null;
var heightmapData = null;

var rotationY = 0; 
var rotationZ = 0; 
var panX = 0;
var panZ = 0;
var zoom = 1.0;

var heightScale = 1.0;
var verticesCopy = null;
var imageBuffer = null;
var originalY = null;

var projectionType;

document.getElementById("height").addEventListener("input", function(e){

    heightScale = e.target.value / 50;  
	console.log("Height:", heightScale);
    if (!verticesCopy) return;

    // updates the Y values based on original heights
    for (let i = 0; i < vertexCount; i++) {
        verticesCopy[i*3 + 1] = originalY[i] * heightScale;
    }

    // push updated data to GPU buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, imageBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verticesCopy);
});

document.getElementById("projection").addEventListener("change", function(e){
    projectionType = e.target.value;
    console.log("Projection changed to:", projectionType);
});

function processImage(img)
{
	// draw the image into an off-screen canvas
	var off = document.createElement('canvas');
	
	var sw = img.width, sh = img.height;
	off.width = sw; off.height = sh;
	
	var ctx = off.getContext('2d');
	ctx.drawImage(img, 0, 0, sw, sh);
	
	// read back the image pixel data
	var imgd = ctx.getImageData(0,0,sw,sh);
	var px = imgd.data;
	
	// create a an array will hold the height value
	var heightArray = new Float32Array(sw * sh);
	
	// loop through the image, rows then columns
	for (var y=0;y<sh;y++) 
	{
		for (var x=0;x<sw;x++) 
		{
			// offset in the image buffer
			var i = (y*sw + x)*4;
			
			// read the RGB pixel value
			var r = px[i+0], g = px[i+1], b = px[i+2];
			
			// convert to greyscale value between 0 and 1
			var lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255.0;

			// store in array
			heightArray[y*sw + x] = lum;
		}
	}

	return {
		data: heightArray,
		width: sw,
		height: sh
	};
}


window.loadImageFile = function(event)
{

	var f = event.target.files && event.target.files[0];
	if (!f) return;
	
	// create a FileReader to read the image file
	var reader = new FileReader();
	reader.onload = function() 
	{
		// create an internal Image object to hold the image into memory
		var img = new Image();
		img.onload = function() 
		{
			// heightmapData is globally defined
			heightmapData = processImage(img);

			let vertices = [];

			let scale = 10; 
			let maxHeight = 2.0;

			function addVertex(col, row, height) { //converts grid coord to vertex
				let x = (col / (heightmapData.width - 1) - 0.5) * scale;
				let z = (row / (heightmapData.height - 1) - 0.5) * scale;
				let y = height * maxHeight; //scales height
				vertices.push(x, y, z);
			}

			for (let row = 0; row < heightmapData.height - 1; row++) {
				for (let col = 0; col < heightmapData.width - 1; col++) {
					let hTL = heightmapData.data[row * heightmapData.width + col];        // top left
					let hTR = heightmapData.data[row * heightmapData.width + (col + 1)];  // top right
					let hBL = heightmapData.data[(row + 1) * heightmapData.width + col];  // bottom left
					let hBR = heightmapData.data[(row + 1) * heightmapData.width + (col + 1)]; // bottom right

					// 1st triangle (TL, TR, BR)
					addVertex(col, row, hTL);
					addVertex(col, row + 1, hTR);
					addVertex(col + 1, row + 1, hBR);

					// 2nd triangle (TL, BR, BL)
					addVertex(col, row, hTL);
					addVertex(col + 1, row + 1, hBR);
					addVertex(col + 1, row, hBL);
				}
			}
			
			vertexCount = vertices.length / 3;

			verticesCopy = new Float32Array(vertices);
			originalY = new Float32Array(vertexCount);

            for (let i = 0; i < vertexCount; i++) {
                originalY[i] = verticesCopy[i * 3 + 1] / maxHeight; // save Y
            }

			imageBuffer = createBuffer(gl, gl.ARRAY_BUFFER, verticesCopy); //Gives WebGL copy on GPU, can now read
			var posAttribLoc = gl.getAttribLocation(program, "position");


			vao = createVAO(gl, 
				// positions
				posAttribLoc, imageBuffer, 

				// normals (unused in this assignments)
				null, null, 

				// colors (not needed--computed by shader)
				null, null
			);
					

			console.log('loaded image: ' + heightmapData.width + ' x ' + heightmapData.height);

		};
		img.onerror = function() 
		{
			console.error("Invalid image file.");
			alert("The selected file could not be loaded as an image.");
		};

		// the source of the image is the data load from the file
		img.src = reader.result;
	};
	reader.readAsDataURL(f);
}


function setupViewMatrix(eye, target)
{
    var forward = normalize(subtract(target, eye));
    var upHint  = [0, 1, 0];

    var right = normalize(cross(forward, upHint));
    var up    = cross(right, forward);

    var view = lookAt(eye, target, up);
    return view;

}

function draw()
{
	if (!heightmapData) {
        requestAnimationFrame(draw);
        return;
    }

	var fovRadians = 70 * Math.PI / 180;
	var aspectRatio = +gl.canvas.width / +gl.canvas.height;
	var nearClip = 0.1;
	var farClip = 50.0;
	
	// perspective projection
	var projectionMatrix = perspectiveMatrix(
		fovRadians,
		aspectRatio,
		nearClip,
		farClip,
	);

	if (projectionType === "perspective") {
        let fovRadians = 70 * Math.PI / 180;
        let nearClip = 0.1;
        let farClip = 50.0;
        projectionMatrix = perspectiveMatrix(fovRadians, aspectRatio, nearClip, farClip);

    } else if (projectionType === "orthographic") {
        let scale = 10 * zoom;

		// Boundaries
        let left = -scale;
		let right = scale;
        let bottom = -scale;
		let top = scale;

        let nearClip = -50;
        let farClip = 50;
        projectionMatrix = orthographicMatrix(left, right, bottom, top, nearClip, farClip);
    }

	var radius = 10 * zoom; //distance
	var eyeX = Math.sin(rotationY) * Math.cos(rotationZ) * radius + panX;
	var eyeZ = Math.cos(rotationY) * Math.cos(rotationZ) * radius + panZ;
    var eyeY = 5 * zoom;

	document.getElementById("rotation").addEventListener("input", function (e) {
		const degrees = parseFloat(e.target.value);
		rotationY = degrees * Math.PI / 180;
	});

	document.getElementById("scale").addEventListener("input", function (e) {
		const value = parseFloat(e.target.value);
    	zoom = 2.0 - (value / 200) * 1.5;
	});


	// eye and target
	var eye = [eyeX, eyeY, eyeZ];
	var target = [panX, 0, panZ];

	var modelMatrix = identityMatrix();


	// setup viewing matrix
	var eyeToTarget = subtract(target, eye);
	var viewMatrix = setupViewMatrix(eye, target);

	// model-view Matrix = view * model
	var modelviewMatrix = multiplyMatrices(viewMatrix, modelMatrix);


	// enable depth testing
	gl.enable(gl.DEPTH_TEST);

	// disable face culling to render both sides of the triangles
	gl.disable(gl.CULL_FACE);

	gl.clearColor(0.2, 0.2, 0.2, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
	gl.useProgram(program);
	
	// update modelview and projection matrices to GPU as uniforms
	gl.uniformMatrix4fv(uniformModelViewLoc, false, new Float32Array(modelviewMatrix));
	gl.uniformMatrix4fv(uniformProjectionLoc, false, new Float32Array(projectionMatrix));

	gl.bindVertexArray(vao);
	
	var primitiveType = gl.TRIANGLES;
	gl.drawArrays(primitiveType, 0, vertexCount);

	requestAnimationFrame(draw);

}

function createBox()
{
	function transformTriangle(triangle, matrix) {
		var v1 = [triangle[0], triangle[1], triangle[2], 1];
		var v2 = [triangle[3], triangle[4], triangle[5], 1];
		var v3 = [triangle[6], triangle[7], triangle[8], 1];

		var newV1 = multiplyMatrixVector(matrix, v1);
		var newV2 = multiplyMatrixVector(matrix, v2);
		var newV3 = multiplyMatrixVector(matrix, v3);

		return [
			newV1[0], newV1[1], newV1[2],
			newV2[0], newV2[1], newV2[2],
			newV3[0], newV3[1], newV3[2]
		];
	}

	var box = [];

	var triangle1 = [
		-1, -1, +1,
		-1, +1, +1,
		+1, -1, +1,
	];
	box.push(...triangle1)

	var triangle2 = [
		+1, -1, +1,
		-1, +1, +1,
		+1, +1, +1
	];
	box.push(...triangle2);

	// 3 rotations of the above face
	for (var i=1; i<=3; i++) 
	{
		var yAngle = i* (90 * Math.PI / 180);
		var yRotMat = rotateYMatrix(yAngle);

		var newT1 = transformTriangle(triangle1, yRotMat);
		var newT2 = transformTriangle(triangle2, yRotMat);

		box.push(...newT1);
		box.push(...newT2);
	}

	// a rotation to provide the base of the box
	var xRotMat = rotateXMatrix(90 * Math.PI / 180);
	box.push(...transformTriangle(triangle1, xRotMat));
	box.push(...transformTriangle(triangle2, xRotMat));


	return {
		positions: box
	};

}

var isDragging = false;
var startX, startY;
var leftMouse = false;

function addMouseCallback(canvas)
{
	isDragging = false;

	canvas.addEventListener("mousedown", function (e) 
	{
		if (e.button === 0) {
			console.log("Left button pressed");
			leftMouse = true;
		} else if (e.button === 2) {
			console.log("Right button pressed");
			leftMouse = false;
		}

		isDragging = true;
		startX = e.offsetX;
		startY = e.offsetY;
	});

	canvas.addEventListener("contextmenu", function(e)  {
		e.preventDefault(); // disables the default right-click menu
	});


	canvas.addEventListener("wheel", function(e)  {
		e.preventDefault(); // prevents page scroll

		if (e.deltaY < 0) 
		{
			console.log("Scrolled up");
			zoom *= 0.9;
			// e.g., zoom in
		} else {
			console.log("Scrolled down");
			// e.g., zoom out
			zoom *= 1.1;
		}
	});

	document.addEventListener("mousemove", function (e) {
		if (!isDragging) return;
		var currentX = e.offsetX;
		var currentY = e.offsetY;

		var deltaX = currentX - startX;
		var deltaY = currentY - startY;
		console.log('mouse drag by: ' + deltaX + ', ' + deltaY);
        
		if (e.shiftKey) {
            // Shift + left drag
            rotationY += deltaX * 0.01;
            rotationZ += deltaY * 0.01;
        } else {
            // Left drag
            panX += deltaX * 0.01;
            panZ += deltaY * 0.01;
        }

		startX = currentX;
		startY = currentY;
	});

	document.addEventListener("mouseup", function () {
		isDragging = false;
	});

	document.addEventListener("mouseleave", () => {
		isDragging = false;
	});
}

function initialize() 
{
	var canvas = document.querySelector("#glcanvas");
	canvas.width = canvas.clientWidth;
	canvas.height = canvas.clientHeight;

	gl = canvas.getContext("webgl2");

	// add mouse callbacks
	addMouseCallback(canvas);

	var box = createBox();
	vertexCount = box.positions.length / 3;		// vertexCount is global variable used by draw()
	console.log(box);

	// create buffers to put in box
	var boxVertices = new Float32Array(box['positions']);
	var posBuffer = createBuffer(gl, gl.ARRAY_BUFFER, boxVertices);

	var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
	var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
	program = createProgram(gl, vertexShader, fragmentShader);

	// attributes (per vertex)
	var posAttribLoc = gl.getAttribLocation(program, "position");

	// uniforms
	uniformModelViewLoc = gl.getUniformLocation(program, 'modelview');
	uniformProjectionLoc = gl.getUniformLocation(program, 'projection');

	vao = createVAO(gl, 
		// positions
		posAttribLoc, posBuffer, 

		// normals (unused in this assignments)
		null, null, 

		// colors (not needed--computed by shader)
		null, null
	);

	window.requestAnimationFrame(draw);
}

window.onload = initialize();