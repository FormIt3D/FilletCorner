if (typeof FilletCorners == 'undefined')
{
    FilletCorners = {};
}

/*** web/UI code - runs natively in the plugin process ***/

// IDs of input elements that need to be referenced or updated
const filletRadiusInputID = 'filletRadiusInput';
const deleteVertexInputID = 'deleteVertexInput';

// initialize the UI
FilletCorners.initializeUI = async function()
{
    // create an overall container for all objects that comprise the "content" of the plugin
    // everything except the footer
    let contentContainer = document.createElement('div');
    contentContainer.id = 'contentContainer';
    contentContainer.className = 'contentContainer'
    window.document.body.appendChild(contentContainer);

    // create the header
    contentContainer.appendChild(new FormIt.PluginUI.HeaderModule('Fillet 2D Corners', '', 'headerContainer').element);

    // unordered lists as necessary
    let detailsUl1 = contentContainer.appendChild(document.createElement('ul'));
    let detailsLi1a = detailsUl1.appendChild(document.createElement('li'));
    detailsLi1a.innerHTML = 'Select vertices, connected edges, or faces';

    let detailsUl2 = detailsUl1.appendChild(document.createElement('ul')); 
    let detailsLi2a = detailsUl2.appendChild(document.createElement('li'));
    detailsLi2a.innerHTML = 'Currently, only corners with 2 attached edges are supported';

    let detailsLi1b = detailsUl1.appendChild(document.createElement('li'));
    detailsLi1b.innerHTML = 'Click "Fillet Corner" to draw a new arc at each 2D corner';

    // create the radius input
    contentContainer.appendChild(new FormIt.PluginUI.TextInputModule('Fillet Radius: ', 'filletRadiusModule', 'inputModuleContainerTop', filletRadiusInputID, FormIt.PluginUI.convertValueToDimensionString).element);
    document.getElementById(filletRadiusInputID).value = await FormIt.StringConversion.LinearValueToString(5);

    // create the delete vertex checkbox
    contentContainer.appendChild(new FormIt.PluginUI.CheckboxModule('Delete Vertex', 'deleteVertexCheckboxModule', 'multiModuleContainer', deleteVertexInputID).element);

    // create the fillet corners button
    contentContainer.appendChild(new FormIt.PluginUI.Button('Fillet Corners', FilletCorners.execute).element);

    // create the footer
    document.body.appendChild(new FormIt.PluginUI.FooterModule().element);
}

FilletCorners.updateUI = async function()
{
    // radius input
    document.getElementById(filletRadiusInputID).value = await FormIt.StringConversion.LinearValueToString((await FormIt.StringConversion.StringToLinearValue(document.getElementById(filletRadiusInputID).value)).second);
}

/*** application code - runs asynchronously from plugin process to communicate with FormIt ***/

// keep track of how many vertices are modified for reporting
let nModifiedVerticesSuccessful = 0;
let nModifiedVerticesUnsuccessful = 0;

FilletCorners.execute = async function()
{
    console.clear();
    console.log("Fillet Corner Plugin");

    // package up the inputs from the HTML page into a single object
    let args = 
    {
        "radius": (await FormIt.StringConversion.StringToLinearValue(document.getElementById(filletRadiusInputID).value)).second,
        "cleanup": document.getElementById(deleteVertexInputID).checked
    }
    
    // get current history
    let nHistoryID = await FormIt.GroupEdit.GetEditingHistoryID();
    //console.log("Current history: " + JSON.stringify(nHistoryID));

    // get current selection
    let currentSelection = await FormIt.Selection.GetSelections();
    //console.log("Current selection: " + JSON.stringify(currentSelection));

    // reset the count of successful and unsuccessful fillet operations
    nModifiedVerticesSuccessful = 0;
    nModifiedVerticesUnsuccessful = 0;

    await FormIt.UndoManagement.BeginState();

    // for each object selected, get the vertexIDs
    for (let j = 0; j < currentSelection.length; j++)
    {
        // if you're not in the Main History, need to calculate the depth to extract the correct history data
        let historyDepth = (currentSelection[j]["ids"].length) -1;
        //console.log("Current history depth: " + historyDepth);

        // get objectID of the current selection
        let nObjectID = currentSelection[j]["ids"][historyDepth]["Object"];

        // get vertexIDs in the current selection
        let nVertexIDs = await WSM.APIGetObjectsByTypeReadOnly(nHistoryID, nObjectID, WSM.nObjectType.nVertexType, false);
        for (let i = 0; i < nVertexIDs.length; i++)
        {
            let nVertexID = nVertexIDs[i];
            //console.log("Vertex ID of current selection (point0): " +  JSON.stringify(nVertexID));
            await FilletCorners.blendVertex(nHistoryID, nVertexID, args.radius, args.cleanup);
        }

    }
    
    // show a message confirming the vertices were blended, or not

    // all vertices were filleted - totally successful
    if (nModifiedVerticesSuccessful > 0 && nModifiedVerticesUnsuccessful == 0)
    {
        let successMessage = "Created a new fillet arc at " + nModifiedVerticesSuccessful + (nModifiedVerticesSuccessful > 1 ? " vertices." : " vertex.");
        await FormIt.UI.ShowNotification(successMessage, FormIt.NotificationType.Success, 0);
    }
    // some were filleted and some failed - partial success
    else if (nModifiedVerticesSuccessful > 0 && nModifiedVerticesUnsuccessful > 0)
    {
        let partialSuccessMessage = "Created a new fillet arc at " + nModifiedVerticesSuccessful + " vertices, but failed to fillet at " + nModifiedVerticesUnsuccessful + (nModifiedVerticesUnsuccessful > 1 ? " vertices." : " vertex.");
        await FormIt.UI.ShowNotification(partialSuccessMessage, FormIt.NotificationType.Information, 0);
    }
    // all failed - no fillet arcs were able to be created
    else if (nModifiedVerticesSuccessful == 0 && nModifiedVerticesUnsuccessful > 0)
    {
        let failureMessage = "Couldn't create a fillet arc at any of the selected vertices.\nTry selecting vertices with only 2 edges attached."
        await FormIt.UI.ShowNotification(failureMessage, FormIt.NotificationType.Error, 0);
    }

    await FormIt.UndoManagement.EndState("Fillet Corner Plugin");
}

FilletCorners.blendVertex = async function(nHistoryID, nVertexID, radius, cleanup) 
{
    // fillet will only work on vertices with 2 attached edges
    let requiredEdgeCount = 2;

    // define the current vertex as point0
    //console.log("---------- define point0 ----------")
    let point0 = await WSM.APIGetVertexPoint3dReadOnly(nHistoryID, nVertexID);
    //console.log("point0 = " + JSON.stringify(point0));

    let pointX0 = point0["x"];
    //console.log("pointX0 = " + JSON.stringify(pointX0));
    let pointY0 = point0["y"];
    //console.log("pointY0 = " + JSON.stringify(pointY0));
    let pointZ0 = point0["z"];
    //console.log("pointZ0 = " + JSON.stringify(pointZ0));

    // get edge IDs attached to point0
    let edgeIDArray = await WSM.APIGetObjectsByTypeReadOnly(nHistoryID, nVertexID, WSM.nObjectType.nEdgeType, true);
    //console.log("Edge IDs attached to point0: " +  JSON.stringify(edgeIDArray));

    // calculate how many edges are attached to point0
    let numberOfEdges = edgeIDArray.length;
    //console.log("Number of edges attached to point0: " + numberOfEdges);
    //console.log("");

    // check if the number of edges attached to vertex is equal to the requirement
    if (numberOfEdges == requiredEdgeCount)
        {
            let remainingVertexIds = [];

            // for each edge, get the vertex IDs
            for (let i = 0; i <= numberOfEdges - 1; i++)
                {
                    // for each edge, returns an array of vertices
                    let getVertexIds = await WSM.APIGetObjectsByTypeReadOnly(nHistoryID, edgeIDArray[i], WSM.nObjectType.nVertexType, false);
                    //console.log("Reading these vertex IDs from edge " + edgeIDArray[i] + ": " + JSON.stringify(getVertexIds));

                    // check if vertex IDs are equal to point0 ID; if they are, push to a new array for add'l processing
                    if (getVertexIds[0] == nVertexID)
                        {
                            remainingVertexIds.push(getVertexIds[1]);
                        }
                    if (getVertexIds[1] == nVertexID)
                        {
                            remainingVertexIds.push(getVertexIds[0]);
                        }
                }
            //console.log("Use these remaining points for analysis: " + remainingVertexIds);

            // get IDs for points 1 and 2
            let point1Id = remainingVertexIds[0];
            let point2Id = remainingVertexIds[1];

            // define point 1
            //console.log("---------- define point1 ----------")
            let point1 = await WSM.APIGetVertexPoint3dReadOnly(nHistoryID, point1Id);
            //console.log("point1 = " + JSON.stringify(point1));

            let pointX1 = point1["x"];
            //console.log("pointX1 = " + JSON.stringify(pointX1));
            let pointY1 = point1["y"];
            //console.log("pointY1 = " + JSON.stringify(pointY1));
            let pointZ1 = point1["z"];
            //console.log("pointZ1 = " + JSON.stringify(pointZ1));
           //console.log("");

            // define point 2
            //console.log("---------- define point2 ----------")
            let point2 = await WSM.APIGetVertexPoint3dReadOnly(nHistoryID, point2Id);
            //console.log("point2 = " + JSON.stringify(point2));

            let pointX2 = point2["x"];
            //console.log("pointX2 = " + JSON.stringify(pointX2));
            let pointY2 = point2["y"];
            //console.log("pointY2 = " + JSON.stringify(pointY2));
            let pointZ2 = point2["z"];
            //console.log("pointZ2 = " + JSON.stringify(pointZ2));
            //console.log("");

            // identify delta values
            let x1Delta = pointX1 - pointX0;
            let y1Delta = pointY1 - pointY0;
            let z1Delta = pointZ1 - pointZ0;

            let x2Delta = pointX2 - pointX0;
            let y2Delta = pointY2 - pointY0;
            let z2Delta = pointZ2 - pointZ0;

            // calculate d1 length
            let d1Length = Math.pow((Math.pow(x1Delta, 2) + Math.pow(y1Delta, 2) + Math.pow(z1Delta, 2)), 0.5);
            //console.log("d1Length = " + d1Length);

            // calculate d1 vectors
            let d1x = x1Delta/d1Length;
            //console.log("d1x = " + d1x);
            let d1y = y1Delta/d1Length;
            //console.log("d1y = " + d1y);
            let d1z = z1Delta/d1Length;
            //console.log("d1z = " + d1z);
            //console.log("");

            // calculate d2 length
            let d2Length = Math.pow((Math.pow(x2Delta, 2) + Math.pow(y2Delta, 2) + Math.pow(z2Delta, 2)), 0.5);
            //console.log("d2Length = " + d2Length);

            // calculate d2 vectors
            let d2x = x2Delta/d2Length;
            //console.log("d2x = " + d2x);
            let d2y = y2Delta/d2Length;
            //console.log("d2y = " + d2y);
            let d2z = z2Delta/d2Length;
            //console.log("d2z = " + d2z);
            //console.log("");

            // calculate d1 and d2 dot product
            let d1d2DotProduct = (d1x * d2x) + (d1y * d2y) + (d1z * d2z);
            //console.log("d1d2DotProduct = " + d1d2DotProduct);

            // calculate angle theta
            let angleTheta = Math.acos(d1d2DotProduct);
            //console.log("angleTheta = " + angleTheta);

            // calculate distance needed from point0 for arc endpoimts
            let travelDistance = radius/Math.tan(angleTheta/2);
            //console.log("travelDistance = " + travelDistance);

            // define new point1
            let newPointX1 = pointX0 + (d1x * travelDistance);
            let newPointY1 = pointY0 + (d1y * travelDistance);
            let newPointZ1 = pointZ0 + (d1z * travelDistance);
            //console.log("newPoint1 (xyz) = " + newPointX1 + ", " + newPointY1 + ", " + newPointZ1);

            // create newPoint1
            let newPoint1 = await WSM.Geom.Point3d(newPointX1, newPointY1, newPointZ1);

            // draw the line between the point0 and newPoint1 for visualization
            //WSM.APIConnectPoint3ds(nHistoryID, point0, newPoint1);

            // define new point2
            let newPointX2 = pointX0 + (d2x * travelDistance);
            let newPointY2 = pointY0 + (d2y * travelDistance);
            let newPointZ2 = pointZ0 + (d2z * travelDistance);
            //console.log("newPoint2 (xyz) = " + newPointX2 + ", " + newPointY2 + ", " + newPointZ2);

            // create newPoint2
            let newPoint2 = await WSM.Geom.Point3d(newPointX2, newPointY2, newPointZ2);

            // draw the line between the point0 and newPoint2 for visualization
            //WSM.APIConnectPoint3ds(nHistoryID, point0, newPoint2);

            // calculate midpoint between newPoint1 and newPoint2
            let midPointX = ((newPointX1 + newPointX2)/2);
            let midPointY = ((newPointY1 + newPointY2)/2);
            let midPointZ = ((newPointZ1 + newPointZ2)/2);
            //console.log("midPoint (xyz) = " + midPointX + ", " + midPointY + ", " + midPointZ)

            // identify delta values
            let midPointDeltaX = midPointX - pointX0;
            let midPointDeltaY = midPointY - pointY0;
            let midPointDeltaZ = midPointZ - pointZ0;

            // calculate distance from midpoint to point0
            let midPointLength = Math.pow((Math.pow(midPointDeltaX, 2) + Math.pow(midPointDeltaY, 2) + Math.pow(midPointDeltaZ, 2)), 0.5);
            //console.log("midPointLength = " + midPointLength);

            // calculate the distance from midPoint to centerPoint
            let midPointCenterPointDistance = radius * (Math.sin(angleTheta/2));
            //console.log("midPointCenterPointDistance = " + midPointCenterPointDistance);

            // calculate the centerPoint
            let centerPointX = midPointX + (midPointCenterPointDistance - radius) * ((midPointX - pointX0)/midPointLength);
            let centerPointY = midPointY + (midPointCenterPointDistance - radius) * ((midPointY - pointY0)/midPointLength);
            let centerPointZ = midPointZ + (midPointCenterPointDistance - radius) * ((midPointZ - pointZ0)/midPointLength);
            //console.log("centerPoint (xyz) = " + centerPointX + ", " + centerPointY + ", " + centerPointZ)

            // create centerPoint
            let centerPoint = await WSM.Geom.Point3d(centerPointX,centerPointY,centerPointZ);

            // FormIt v18 and newer has a global curve faceting setting - use that here
            let nCurveFacets = await FormIt.Model.GetCurveAccuracyOrCountCurrent();
            
            // create new arc
            await WSM.APICreateCircleOrArcFromPoints(nHistoryID, newPoint1, newPoint2, centerPoint, nCurveFacets);
            console.log("Successfully created a new arc with radius " + radius + " at vertexID " + nVertexID + ".");

            // increment the number of successful fillet arcs for this operation
            nModifiedVerticesSuccessful++;

            // delete the vertex if the option is checked
            if (cleanup) 
            {
                await WSM.APIDeleteObject(nHistoryID, nVertexID);
                console.log("Deleted vertexID " + nVertexID);
            }
        }
    else 
        {
            console.log("Error: too few or too many edges attached at this vertex (vertexID: " + nVertexID + ").");

            // increment the number of failures for this operation
            nModifiedVerticesUnsuccessful++;
        }
}

