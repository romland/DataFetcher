# DataFetcher
A node.js library to fetch remote data based on seed data; thrown together quickly because I needed it. Packaged it up because I might need again.

This is mostly for when you need to be a bit naughty, i.e. they do not want you to get that remote data. 

The library handles the boring stuff:
- proxying
- delay tasks
- retry on fail
- user-agent randomization
- randomize order of queries
- (for now naive) csv import/export
- re-assembly of CSV files with fetched data
- error recovery (and caching in case of crash)
- back-off period (in case of rate-limit/block/ban)
- ...and more

If you are being naughty, you will want to use one of the many proxy providers to fetch from a "random" IP address.

See examples/full.js for the clues.


## Installation
```
npm install github:romland/DataFetcher
```

## Usage
```javascript
import DataFetcher from "DataFetcher";

const config = DataFetcher.getDefaultConfiguration();

// Check examples/full.js for configuration options

const df = new DataFetcher(config);
df.run();
```


## Current limitations
The limitations are there only because I have not needed anything else. 

- Very naive CSV handling (no support for quotes nor escaped delimeters)
- Only support seed files in CSV
- Can only create CSV files
- Can only send the following request type(s):
	- POST form fields with content-type application/x-www-form-urlencoded

It should be easy to add broader support.


## Additional notes
If you are not using a proxy, just do `config.remoteProxy = undefined;`


## Code
Tabs are awesome. Four-space tabs doubly so.


## License
MIT.
