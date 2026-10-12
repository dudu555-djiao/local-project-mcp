import Cocoa
let output = CommandLine.arguments[1]
let image=NSImage(size:NSSize(width:1024,height:1024))
image.lockFocus()
NSColor(calibratedRed:0.11,green:0.22,blue:0.17,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:20,y:20,width:984,height:984),xRadius:215,yRadius:215).fill()
NSColor(calibratedRed:0.83,green:0.94,blue:0.70,alpha:1).setFill()
let folder=NSBezierPath();folder.move(to:NSPoint(x:225,y:320));folder.line(to:NSPoint(x:225,y:640));folder.curve(to:NSPoint(x:265,y:680),controlPoint1:NSPoint(x:225,y:665),controlPoint2:NSPoint(x:240,y:680));folder.line(to:NSPoint(x:410,y:680));folder.line(to:NSPoint(x:455,y:625));folder.line(to:NSPoint(x:755,y:625));folder.curve(to:NSPoint(x:795,y:585),controlPoint1:NSPoint(x:780,y:625),controlPoint2:NSPoint(x:795,y:610));folder.line(to:NSPoint(x:795,y:320));folder.curve(to:NSPoint(x:755,y:280),controlPoint1:NSPoint(x:795,y:295),controlPoint2:NSPoint(x:780,y:280));folder.line(to:NSPoint(x:265,y:280));folder.curve(to:NSPoint(x:225,y:320),controlPoint1:NSPoint(x:240,y:280),controlPoint2:NSPoint(x:225,y:295));folder.close();folder.fill()
let attributes:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:275,weight:.semibold),.foregroundColor:NSColor(calibratedRed:0.16,green:0.32,blue:0.23,alpha:1)]
("L" as NSString).draw(at:NSPoint(x:432,y:309),withAttributes:attributes)
image.unlockFocus()
let data=NSBitmapImageRep(data:image.tiffRepresentation!)!.representation(using:.png,properties:[:])!
try data.write(to:URL(fileURLWithPath:output))
