import DataFetcher from "../index.js";
import fs from 'fs';

const DRY_RUN = true;

const config = DataFetcher.getDefaultConfiguration();

/**
 * Describe format of the seed data.
 */
config.seedDataFormat = {
	format : "CSV",
	lineTerminator : "\r\n",
	separator : ","
};

/**
 *	Describe the data in the seed file.
 * 
 *	Define which columns are needed for fetching remote data. These columns must together be a unique key
 *	They are used to verify if a record as already fetched (handy in case you need to restart midway).
 *
 * 	Example of a seed file:
 *		Column row (line 1):	zipcode,number,addition,room,street,city,otherdata,otherdata2,otherdata3,otherdata4
 *		Data row (line 2):		1234AB,1,,,TheStreet,TheTown,,,,,#N/A
 */
 config.relevantSeedDataColumns = {
	zipcode : 0,				// in CSV: zipcode
	number : 1,					// in CSV: number
	addition : 2				// in CSV: addition
}

/**
 * Describe the remote service.
 * 
 * Which fields should be used from the seed-data to pass on to remote service.
 * 
 * This function is called before every request.
 * 
 *	NOTE:
 *	1. The keys are the field names you want to pass to remote service
 *	2. The values must match name of keys in relevantSeedDataColumns
 */
config.getBodyToPassToRemoteServer = (seedRow) => {
	return new URLSearchParams(
		{
			"zip" : "" + seedRow.zipcode,
			"num" : "" + seedRow.number,
			"ext" : "" + seedRow.addition
		}
	);
}

/**
 * If necessary, describe how to determine whether we need to back off from the 
 * remote service for N minutes.
 */
config.queryRateLimit = (response, seedRow) => {
	return response["error"] === "Slow down."
}

/**
 *	This is the opportunity to do some post-processing on fetched data
 *	before it is written to the new CSV file.
 *
 *  NOTE: The flag must be true or responses will not be cached (and 
 *	      postRunRefineRecord() will not be called).
 */
config.postRunRefineEnabled = true;
config.postRunRefineRecord = (response) => {
	return {
		"seedindex" : response._seedrow.id,							// Index of record in the seed file
		"fetching" : "" + response._fetchEnabled,					// Are we fetching data from remote service or dry-run?
		"origin" : response._fetchEnabled ? response.origin : "n/a"	// This comes from the default remote service (httpbin.org)
	};
};

if(DRY_RUN) {
	config.runType = "DRY";
	config.seedFilename = './examples/data/test.csv';
	config.remoteServiceUrl = 'https://httpbin.org/post';
	config.fetchEnabled = false;
} else {
	config.runType = "REAL";
	config.seedFilename = './realseeddata.csv';
	config.remoteServiceUrl = 'https://some.remoteservice.nl/form.php';
	config.fetchEnabled = true;
}

// Separate cache from test runs and live runs (in case we need to restart and test midway)
config.responseCacheFilename = './examples/data/output/' + config.runType + '-responsecache.json';

/**
 * We want to use a proxy server. This is passed as-is to Axios.
 */
 config.remoteProxy = {
	host: 'proxy.scrapingbee.com',
	port: 8886,
	auth: {
		username: 'SECRET', 
		password: 'render_js=false&forward_headers_pure=true'
	}
};


console.log("Config:", config);
const df = new DataFetcher(config);
df.run();
