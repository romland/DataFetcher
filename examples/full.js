import DataFetcher from "../src/DataFetcher.js";

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
 *	Describe the CSV file (seed data).
 * 
 *	Define which columns are needed for fetching remote data. These columns must together define a unique key
 *	to be able to determine which records were already fetched (in case you are restarting the task but want
 *	to exclude already fetched data).
 *
 * 	Example:
 *		Column row:	zipcode,number,addition,room,street,city,otherdata,otherdata2,otherdata3,otherdata4
 *		Data row:	1234AB,1,,,TheStreet,TheTown,,,,,#N/A
 */
 config.relevantSeedDataColumns = {
	zipcode : 0,				// in CSV: zipcode
	number : 1,					// in CSV: number
	housenumberext : 2			// in CSV: addition
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
 *	2. The values must match name of keys in SEEDDATA_COLUMNS
 */
config.getBodyToPassToRemoteServer = (seedRow) => {
	return new URLSearchParams(
		{
			"zip" : "" + seedRow.zipcode,
			"num" : "" + seedRow.number,
			"ext" : "" + seedRow.housenumberext
		}
	);
}

/**
 * If necessary, describe how to determine whether we need to back off from the 
 * remote service for a N minutes.
 */
config.queryRateLimit = (response, seedRow) => {
	return response["error"] === "Slow down."
}

if(DRY_RUN) {
	config.runType = "DRY";
	config.seedFilename = './examples/data/test.csv';
	config.destFilename = './examples/data/output/dryrun-seed-responses.json';
	config.remoteServiceUrl = 'https://httpbin.org/post';
	config.fetchEnabled = false;
} else {
	config.runType = "REAL";
	config.seedFilename = './realseeddata.csv';
	config.destFilename = './seed-responses.json';
	config.remoteServiceUrl = 'https://some.remoteservice.nl/form.php';
	config.fetchEnabled = true;
}

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
