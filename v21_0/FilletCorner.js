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

    let detailsLi1b = detailsUl1.appendChild(document.createElement('li'));
    detailsLi1b.innerHTML = 'Click "Fillet Corner" to draw a new arc at each 2D corner';

    // create the radius input
    contentContainer.appendChild(new FormIt.PluginUI.TextInputModule('Fillet Radius: ', 'filletRadiusModule', 'inputModuleContainerTop', filletRadiusInputID, FormIt.PluginUI.convertValueToDimensionString).element);
    document.getElementById(filletRadiusInputID).value = await FormIt.StringConversion.LinearValueToString(5);

    // create the delete vertex checkbox
    contentContainer.appendChild(new FormIt.PluginUI.CheckboxModule('Delete original vertices', 'deleteVertexCheckboxModule', 'multiModuleContainer', deleteVertexInputID).element);

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

// the current history and history depth
let nHistoryID;

// an array of object types in the current selection
let aCurrentSelection = [];
let aAssociatedVertexIds = [];
let aAssociatedEdgeIds = [];

// keep track of how many vertices are modified for reporting
let aModifiedVerticesSuccesful = [];
let nModifiedVerticesSuccessful = 0;
let nModifiedVerticesUnsuccessful = 0;

// stores information about the current selection
FilletCorners.getSelectionInfo = async function()
{
    // clear arrays
    aCurrentSelection = [];
    aAssociatedVertexIds = [];
    aAssociatedEdgeIds = [];

    // store the current selection for the rest of the script to access
    aCurrentSelection = await FormIt.Selection.GetSelections();

    // for each object in the selection, fill out arrays
    for (var j = 0; j < aCurrentSelection.length; j++)
    {
        // if you're not in the Main History, need to calculate the depth to extract the correct history data
        let historyDepth = (aCurrentSelection[j]["ids"].length) -1;
        //console.log("Current history depth: " + historyDepth);

        // get objectID of the current selection
        let nObjectID = aCurrentSelection[j]["ids"][historyDepth]["Object"];

        // get "associated" vertices
        // (vertices either directly selected or part of an attached edge or face)
        aAssociatedVertexIds.push(await WSM.APIGetObjectsByTypeReadOnly(nHistoryID, nObjectID, WSM.nObjectType.nVertexType));

        // get "associated" edges
        // (edges either directly selected or bordering a selected face)
        aAssociatedEdgeIds.push(await WSM.APIGetObjectsByTypeReadOnly(nHistoryID, nObjectID, WSM.nObjectType.nEdgeType));
    }

    // clean up arrays - flatten and remove duplicates
    aAssociatedVertexIds = flattenArray(aAssociatedVertexIds);
    aAssociatedVertexIds = eliminateDuplicatesInArray(aAssociatedVertexIds);
    console.log("Total associated vertices: " + aAssociatedVertexIds.length);

    aAssociatedEdgeIds = flattenArray(aAssociatedEdgeIds);
    aAssociatedEdgeIds = eliminateDuplicatesInArray(aAssociatedEdgeIds);
    console.log("Total associated edges: " + aAssociatedEdgeIds.length);

    // now that we've filled out arrays, return the selection
    return aCurrentSelection;
}

// gets the "composite" edges from a vertex
// composite edges means the intersection of the attached edges, and associated edges (indirectly part of selection)
FilletCorners.getCompositeEdges = async function(nVertexId)
{
    // the final list of edges
    let aAdjustedEdgeIds = [];

    // get edge IDs attached to the given vertex
    let aAttachedEdgeIds = await WSM.APIGetObjectsByTypeReadOnly(nHistoryID, nVertexId, WSM.nObjectType.nEdgeType, true);
    //console.log("Edge IDs attached to this vertex: " +  JSON.stringify(aAttachedEdgeIds));

    // for each of the attached edges, only use it in the filtered list
    // if it's also represented in one of the associated edges
    for (var j = 0; j < aAttachedEdgeIds.length; j++)
    {
        //console.log("Attached edges: " + aAttachedEdgeIds.length);
        //let associatedEdgeIndex = aAssociatedEdgeIds.indexOf(aAttachedEdgeIds[j]);
        if (aAssociatedEdgeIds.includes(aAttachedEdgeIds[j]))
        {
            aAdjustedEdgeIds.push(aAttachedEdgeIds[j]);
            //console.log("Attached edge " + aAttachedEdgeIds[j] + " was found in the array of associated edges.");
        }
        else
        {
            //console.log("Attached edge " + aAttachedEdgeIds[j] + " was NOT found in the array of associated edges.");
        }
    }

    //console.log("Composite edge IDs: " + aAdjustedEdgeIds);
    return aAdjustedEdgeIds;
}

// determines whether a given vertex is a blend candidate
FilletCorners.getIsBlendCandidate = async function(nVertexId)
{
    // determine how many composite edge Ids are attached to this vertex
    // composite edges means the intersection of the attached edges, and associated edges (indirectly part of selection)
    let aCompositeEdgeIds = await FilletCorners.getCompositeEdges(nVertexId);

    if (aCompositeEdgeIds.length == 2 || aCompositeEdgeIds.length == 0)
    {
        return true;
    }
    else
    {
        return false;
    }
}

// runs when the button is clicked
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
    nHistoryID = await FormIt.GroupEdit.GetEditingHistoryID();
    //console.log("Current history: " + JSON.stringify(nHistoryID));

    // get current selection info and fill out arrays
    await FilletCorners.getSelectionInfo();
    
    // if no selection, put up a message and stop
    if (aCurrentSelection.length == 0)
    {
        let noSelectionMessage = "Select vertices, edges, or faces to begin.";
        await FormIt.UI.ShowNotification(noSelectionMessage, FormIt.NotificationType.Information, 0);
        return;
    }

    // reset the count of successful and unsuccessful fillet operations
    aModifiedVerticesSuccesful = [];
    nModifiedVerticesSuccessful = 0;
    nModifiedVerticesUnsuccessful = 0;

    await FormIt.UndoManagement.BeginState();

    // create a final list of fillet vertices
    let aFinalVertices = [];
    let aFinalCompositeEdges = [];

    // get the final vertices
    for (var i = 0; i < aAssociatedVertexIds.length; i++)
    {
        // first, check if this vertex is a valid blend candidate
        let bIsFilletCandidate = await FilletCorners.getIsBlendCandidate(aAssociatedVertexIds[i]);

        if (bIsFilletCandidate)
        {
            aFinalVertices.push(aAssociatedVertexIds[i]);
            aFinalCompositeEdges.push(await FilletCorners.getCompositeEdges(aAssociatedVertexIds[i]));
            console.log("Vertex " + aAssociatedVertexIds[i] + " will be filleted.");
        }
        else
        {
            console.log("Vertex " + aAssociatedVertexIds[i] + " is not a fillet candidate (too few attached edges also part of the selection set).");
        }
    }

    // blend the final vertieces
    for (var i = 0; i < aFinalVertices.length; i++)
    {
        await FilletCorners.blendVertex(nHistoryID, aFinalCompositeEdges[i], aFinalVertices[i], args.radius);
    }

    // delete the original vertices if requested
    if (args.cleanup) 
    {
        await FilletCorners.deleteVertices();
    }
    
    // communicate to the user whether the vertices were blended or not

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
    else if (aFinalCompositeEdges.length == 0 || (nModifiedVerticesSuccessful == 0 && nModifiedVerticesUnsuccessful > 0))
    {
        let failureMessage = "Failed to create a fillet arc given the selected geometry.\nTry selecting faces, connected edges, or vertices with at least 2 attached edges, and try again."
        await FormIt.UI.ShowNotification(failureMessage, FormIt.NotificationType.Error, 0);
    }

    await FormIt.UndoManagement.EndState("Fillet Corner Plugin");
}

FilletCorners.blendVertex = async function(nHistoryID, aCompositeEdgeIds, nVertexID, radius) 
{
    // define the current vertex as point0
    //console.log("---------- define point0 ----------")
    let point3DFromVertex = await WSM.APIGetVertexPoint3dReadOnly(nHistoryID, nVertexID);
    //console.log("point0 = " + JSON.stringify(point0));

    let point3dX = point3DFromVertex["x"];
    //console.log("pointX0 = " + JSON.stringify(pointX0));
    let point3dY = point3DFromVertex["y"];
    //console.log("pointY0 = " + JSON.stringify(pointY0));
    let point3dZ = point3DFromVertex["z"];
    //console.log("pointZ0 = " + JSON.stringify(pointZ0));

    // these are the vertices that will be used to create the endpoints of the arc
    let aOuterVertexIds = [];

    // if composite edges are available, that means the user selected edges or faces
    // if not, the vertex is directly selectd, so we'll use the attached edge Ids instead
    let aCompositeOrAttachedEdgeIds = [];
    // if no composite edges, this vertex is directly selected
    if (aCompositeEdgeIds.length == 0)
    {
        aCompositeOrAttachedEdgeIds = await WSM.APIGetObjectsByTypeReadOnly(nHistoryID, nVertexID, WSM.nObjectType.nEdgeType, true);
    }
    else
    {
        aCompositeOrAttachedEdgeIds = aCompositeEdgeIds;
    }

    // for each edge, determine the correct outer vertex
    for (var i = 0; i < aCompositeOrAttachedEdgeIds.length; i++)
    {
        // get the vertices from each edge
        let aVertexIdsFromEdge = await WSM.APIGetObjectsByTypeReadOnly(nHistoryID, aCompositeOrAttachedEdgeIds[i], WSM.nObjectType.nVertexType, false);
        //console.log("Reading these vertex IDs from edge " + aAdjustedEdgeIds[i] + ": " + JSON.stringify(aVertexIdsFromEdge));

        if (aVertexIdsFromEdge[0] == nVertexID)
        {
            aOuterVertexIds.push(aVertexIdsFromEdge[1]);
        }
        else
        {
            aOuterVertexIds.push(aVertexIdsFromEdge[0]);
        }
    }
    //console.log("Use these remaining points for analysis: " + remainingVertexIds);

    // avoid errors
    if (aOuterVertexIds.length < 2)
    {
        return;
    }

    // refer to the outer points as point 1 and point 2
    let point1Id = aOuterVertexIds[0];
    let point2Id = aOuterVertexIds[1];

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
    let x1Delta = pointX1 - point3dX;
    let y1Delta = pointY1 - point3dY;
    let z1Delta = pointZ1 - point3dZ;

    let x2Delta = pointX2 - point3dX;
    let y2Delta = pointY2 - point3dY;
    let z2Delta = pointZ2 - point3dZ;

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
    let newPointX1 = point3dX + (d1x * travelDistance);
    let newPointY1 = point3dY + (d1y * travelDistance);
    let newPointZ1 = point3dZ + (d1z * travelDistance);
    //console.log("newPoint1 (xyz) = " + newPointX1 + ", " + newPointY1 + ", " + newPointZ1);

    // create newPoint1
    let newPoint1 = await WSM.Geom.Point3d(newPointX1, newPointY1, newPointZ1);

    // draw the line between the point0 and newPoint1 for visualization
    //WSM.APIConnectPoint3ds(nHistoryID, point0, newPoint1);

    // define new point2
    let newPointX2 = point3dX + (d2x * travelDistance);
    let newPointY2 = point3dY + (d2y * travelDistance);
    let newPointZ2 = point3dZ + (d2z * travelDistance);
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
    let midPointDeltaX = midPointX - point3dX;
    let midPointDeltaY = midPointY - point3dY;
    let midPointDeltaZ = midPointZ - point3dZ;

    // calculate distance from midpoint to point0
    let midPointLength = Math.pow((Math.pow(midPointDeltaX, 2) + Math.pow(midPointDeltaY, 2) + Math.pow(midPointDeltaZ, 2)), 0.5);
    //console.log("midPointLength = " + midPointLength);

    // calculate the distance from midPoint to centerPoint
    let midPointCenterPointDistance = radius * (Math.sin(angleTheta/2));
    //console.log("midPointCenterPointDistance = " + midPointCenterPointDistance);

    // calculate the centerPoint
    let centerPointX = midPointX + (midPointCenterPointDistance - radius) * ((midPointX - point3dX)/midPointLength);
    let centerPointY = midPointY + (midPointCenterPointDistance - radius) * ((midPointY - point3dY)/midPointLength);
    let centerPointZ = midPointZ + (midPointCenterPointDistance - radius) * ((midPointZ - point3dZ)/midPointLength);
    //console.log("centerPoint (xyz) = " + centerPointX + ", " + centerPointY + ", " + centerPointZ)

    // if any of these points are invalid, stop to avoid errors
    if (isNaN(centerPointX) || isNaN(centerPointY) || isNaN(centerPointZ))
    {
        return;
    }

    // create centerPoint
    let centerPoint = await WSM.Geom.Point3d(centerPointX, centerPointY, centerPointZ);

    // FormIt v18 and newer has a global curve faceting setting - use that here
    let nCurveFacets = await FormIt.Model.GetCurveAccuracyOrCountCurrent();

    // create new arc
    await WSM.APICreateCircleOrArcFromPoints(nHistoryID, newPoint1, newPoint2, centerPoint, nCurveFacets);
    console.log("Successfully created a new arc with radius " + radius + " at vertexID " + nVertexID + ".");

    // increment the number of successful fillet arcs for this operation
    nModifiedVerticesSuccessful++;
    aModifiedVerticesSuccesful.push(nVertexID);
    // add the vertex ID that's been filleted to the array
}

// delete all vertices marked for deletion
FilletCorners.deleteVertices = async function()
{
    for (let i = 0; i < aModifiedVerticesSuccesful.length; i++)
    {
        await WSM.APIDeleteObject(nHistoryID, aModifiedVerticesSuccesful[i]);
    }
}

