import requests
import pandas as pd
from tqdm import tqdm
import concurrent.futures

###################################################
#fuck it, was trying to use Fraine's ExomastAPI wrapper,
#but I'm dumb and can't install it correctly, so I'm just gonna do things manually
def exo_MAST_get_identifiters(planet_name,retry=False):
    #first lets get the planet identifiers (names)
    #this one should be more flexible? HD189733b
    #tested, seems to work for HD-189733b, hd 189733 b, HD 189733 b
    print('Looking for planet: {}'.format(planet_name))

    url = 'https://exo.mast.stsci.edu/api/v0.1/exoplanets/identifiers/?name={}'.format(planet_name)
    print('Query: ',url)

    try:
        r = requests.get(url)
        
        planet_identifiers_dict = r.json() #For this query this is a dict type object

        if len(planet_identifiers_dict) != 0:
            print('Planet name found \n')
            #print(planet_identifiers_dict)
        else:
            if not retry:
                print('Error: planet not found, trying adding an A: \n')
                planet_name = planet_name.replace(' b', ' A b')
                planet_identifiers_dict = exo_MAST_get_identifiters(planet_name,retry=True)
            else:
                print('Error: Nope, planet really could not be found\n')
                planet_identifiers_dict = None
            
    except:
        print('Error: planet not found \n')
        planet_identifiers_dict = None

    return planet_identifiers_dict


def exo_MAST_get_properties(planet_name):
    #planet_name is a str with spaces which MUST be the canonical name in exoMASt
    #Use the get_identifiers function to find this

    #fudge fix because exomast breaks tehir own canoncial name rule for TOIs!
    if 'TOI' in planet_name:
        planet_name = planet_name.replace('TOI ', 'TOI-')
        planet_html = planet_name.replace(' ', '%20')
    else:
        planet_html = planet_name.replace(' ', '%20')
    print('Trying planet: {}, reformatting as: {}'.format(planet_name,planet_html))

    #ok now lets get the planet properties
    url = 'https://exo.mast.stsci.edu/api/v0.1/exoplanets/{}/properties'.format(planet_html)
    print('Query: ',url)


    try:
        r = requests.get(url)
        print('Planet properties found \n')
        planet_properties_dict = r.json()[0] #just getting the formatting from the query result, is 1 item list

    except:
        print('Error: planet properties not found, check name is canonical \n')
        planet_properties_dict = None
    
    return planet_properties_dict

###################################################
def process_planet(planet_name):
    identifiers = exo_MAST_get_identifiters(planet_name)
    if identifiers is not None and 'canonicalName' in identifiers:
        canonical_name = identifiers['canonicalName']
        properties = exo_MAST_get_properties(canonical_name)
    else:
        canonical_name = None
        properties = None
    return {
        'pl_name': planet_name,
        'canonical_name': canonical_name,
        'identifiers': identifiers,
        'properties': properties
    }

###################################################
# Load the CSV file
csv_path = "../databases/Target_selection_teq_radj_cuts.csv"
df = pd.read_csv(csv_path)

print("Total number of entries:", len(df))

###################################################
results = []
for planet_name in tqdm(df['pl_name'], desc="Processing planets"):
    result = process_planet(planet_name)
    results.append(result)

# Unpack 'properties' dict into columns
flat_results = []
for entry in results:
    base = {k: v for k, v in entry.items() if k not in ['properties', 'identifiers']}
    properties = entry.get('properties') or {}
    identifiers = entry.get('identifiers') or {}
    flat_entry = {**base, **identifiers, **properties}
    flat_results.append(flat_entry)

output_df = pd.DataFrame(flat_results)
output_df.to_csv("exomast_planet_results.csv", index=False)
