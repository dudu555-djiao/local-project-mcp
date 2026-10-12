import Foundation
@main struct HealthTests {
 static func main() {
  let disconnected="commands_poll_last_successful_timestamp_seconds{scope=\"test\"} 0\ncommands_poll_errors_total{error_kind=\"timeout\"} 11"
  precondition(tunnelConnectionAssessment(ready:true,metrics:disconnected,now:1040).state == "starting")
  let connected="commands_poll_last_successful_timestamp_seconds{scope=\"test\"} 1000\ncommands_poll_errors_total{error_kind=\"timeout\"} 10"
  precondition(tunnelConnectionAssessment(ready:true,metrics:connected,now:1040).state == "connected")
  precondition(tunnelConnectionAssessment(ready:true,metrics:connected,now:1100).state == "starting")
  precondition(tunnelConnectionAssessment(ready:false,metrics:connected,now:1040).state == "starting")
  precondition(tunnelConnectionAssessment(ready:true,metrics:nil).state == "starting")
  precondition(tunnelConnectionAssessment(ready:true,metrics:"malformed").state == "starting")
  print("6 tunnel health regression checks passed")
 }
}
